/**
 * Drop service for X ChromaBot.
 * The single code path that composes and posts one drop (template -> X -> telemetry -> log).
 * Used by the scheduler tick, manual post/trigger routes, the webhook and the CLI.
 * It knows nothing about timers; X and Gemini are injected so tests can stub them.
 */

import type { ColorData, TweetContext } from '../../shared/types.js';
import { formatTimeInZone, hourInZone, slotTypeForHour } from '../../shared/time.js';
import { checkTweetText } from '../../shared/tweetLength.js';
import { HttpError } from '../middleware/error.js';
import { resolveTemplateText } from '../templateAgent.js';
import { postColorTweet, type TwitterCredentials } from '../twitterClient.js';
import { classifyXError, type XErrorClass } from '../xErrors.js';
import { DEFAULT_ACCOUNT_ID } from '../../shared/types.js';
import { composeDropText, isEvolutionEnabled, nextHashtagState, usedHashtags } from './dropText.js';
import type { ComposeOptions } from './dropText.js';
import { hashtagService, type HashtagService } from './hashtagService.js';
import { services, type Services } from './index.js';

export interface ExecuteDropOptions {
  contextId?: string;
  slotType?: 'morning' | 'evening' | 'manual';
  color?: ColorData;
  /**
   * Overrides the per-campaign dry-run only. It never overrides the global dry-run switch,
   * which only the owner can turn off (Settings / `globalDryRun`).
   */
  forceLive?: boolean;
  /** Forces a simulation for this call (CLI `--dry-run`); a pure preview, so it ignores global pause. */
  forceDryRun?: boolean;
  /** Exact text to post (e.g. the previewed text); skips template resolution. Still length-checked. */
  text?: string;
  /** Evolved hashtags the previewed `text` used (from the preview response); avoids re-rolling. */
  hashtags?: string[];
  source?: 'scheduler' | 'webhook' | 'manual' | 'cli';
}

export interface DropDeps {
  services: Pick<Services, 'contexts' | 'queue' | 'logs' | 'accounts' | 'rateLimit' | 'settings'>;
  postColorTweet: typeof postColorTweet;
  resolveTemplateText: typeof resolveTemplateText;
  /** Evolving-hashtag generator; defaults to the Gemini-with-offline-fallback service. */
  hashtags?: Pick<HashtagService, 'next'>;
}

type TweetResult = Awaited<ReturnType<typeof postColorTweet>>;
type Creds = TwitterCredentials;

/** Rate-limit / cooldown responses: set the posting account's cooldown. */
const isCooldown = (r: TweetResult) =>
  !!(
    r.isRateLimitOrCooldown ||
    r.rawResponse?.status === 429 ||
    r.error?.includes('cooldown') ||
    r.error?.includes('not permitted to access this feature')
  );

/** Classifies a failed post by HTTP status and X error body (network/timeouts have no status). */
const classify = (r: TweetResult) =>
  classifyXError(r.httpStatus ?? r.rawResponse?.status, r.rawResponse ?? { detail: r.error });

export const createDropService = (deps: DropDeps) => {
  const s = deps.services;
  const hashtags = deps.hashtags ?? hashtagService;

  /** Builds the drop text (template + evolved hashtags); shared by the preview route and posting. */
  const composeText = (context: TweetContext, color: ColorData, options: ComposeOptions = {}) =>
    composeDropText({ resolveTemplateText: deps.resolveTemplateText, hashtags }, context, color, {
      ...options,
      slotLabel: options.slotLabel ?? formatTimeInZone(new Date(), context.schedule?.timezone),
    });

  const describeMode = (
    context: TweetContext,
    mode: string,
    replyTo: string | undefined,
    chainInfo: { isFirstInChain: boolean },
  ) => {
    if (mode === 'reply') {
      const how =
        context.replyTargetMode === 'last_comment'
          ? chainInfo.isFirstInChain
            ? 'Initiating cascade from root'
            : 'Cascading reply to last comment'
          : 'Direct reply to original root';
      return `(Target #${replyTo}, ${how})`;
    }
    if (mode === 'quote') return `(Quoting Post #${context.targetTweetId})`;
    return mode === 'standalone' ? '(Timeline post)' : '';
  };

  /** Retry once on the root post, only when the cascading anchor was deleted (target_missing). */
  const recoverChain = async (
    context: TweetContext,
    first: TweetResult,
    text: string,
    replyTo: string | undefined,
    creds: Creds,
    isDryRun: boolean,
    accountHandle?: string,
  ): Promise<TweetResult> => {
    if (classify(first) !== 'target_missing') {
      console.log(
        `[Drop] Preserving chain anchor #${replyTo} for context "${context.name}" (${classify(first)}: ${first.error}).`,
      );
      return first;
    }
    console.log(
      `[Drop] Cascading anchor #${replyTo} for context "${context.name}" no longer exists (${first.error}). Resetting anchor to primary root post #${context.targetTweetId}.`,
    );
    s.contexts.clearContextAnchor(context.id);
    if (isDryRun) return first;
    const fallback = await deps.postColorTweet(
      creds,
      { text, replyToTweetId: context.targetTweetId, engagementMode: 'reply', accountHandle },
      isDryRun,
    );
    return fallback.success ? fallback : first;
  };

  /** One quote-tweet retry of a reply X refused (cooldown / reply restriction), opt-in per campaign. */
  const quoteFallback = async (
    context: TweetContext,
    first: TweetResult,
    text: string,
    creds: Creds,
    isDryRun: boolean,
    accountHandle?: string,
  ): Promise<TweetResult | undefined> => {
    const errorClass = classify(first);
    if (errorClass !== 'cooldown' && errorClass !== 'reply_restricted') return undefined;
    if (!/^\d+$/.test(context.targetTweetId)) return undefined;
    console.log(
      `[Drop] Reply for context "${context.name}" refused (${errorClass}: ${first.error}). Retrying once as a quote of #${context.targetTweetId}.`,
    );
    const retry = await deps.postColorTweet(
      creds,
      { text, quoteTweetId: context.targetTweetId, engagementMode: 'quote', accountHandle },
      isDryRun,
    );
    return retry.success ? retry : undefined;
  };

  /** Cooldown and live-post spacing are per X account; the header telemetry stays app-wide. */
  const recordTelemetry = (res: TweetResult, isDryRun: boolean, accountId?: string) => {
    if (res.rateLimitHeaders) s.rateLimit.updateRateLimitTelemetry(res.rateLimitHeaders);
    if (!isDryRun && isCooldown(res)) {
      s.rateLimit.setCooldown(
        15,
        res.error || 'X API Rate Limit / Reply Cooldown Active',
        accountId,
      );
    }
    if (!isDryRun && res.success) s.rateLimit.recordLivePostTimestamp(accountId);
  };

  /** Execute a drop for a specific context or the active context. */
  const executeDrop = async (options: ExecuteDropOptions = {}) => {
    const source = options.source || 'manual';
    // Global pause stops every scheduled path; manual posting is still allowed.
    if (source !== 'manual' && !options.forceDryRun && s.settings.isGlobalPaused()) {
      throw new HttpError(409, 'Global pause is on: scheduled drops are stopped');
    }
    const requested = options.contextId ? s.contexts.getContext(options.contextId) : undefined;
    if (options.contextId && !requested) {
      throw new HttpError(404, `Context ${options.contextId} not found`);
    }
    const context: TweetContext = requested || s.contexts.getActiveContext();

    const isMorning = options.slotType
      ? options.slotType === 'morning'
      : slotTypeForHour(hourInZone(new Date(), context.schedule?.timezone)) === 'morning';
    const slotType = options.slotType || (isMorning ? 'morning' : 'evening');
    const color: ColorData =
      options.color ||
      s.queue.popNextQueueSlot(slotType === 'morning' ? 'morning' : 'evening', context.id);
    const composed =
      options.text !== undefined
        ? { text: options.text, hashtags: options.hashtags }
        : await composeText(context, color);
    const text = composed.text;
    const textCheck = checkTweetText(text);
    if (!textCheck.ok) {
      throw new HttpError(400, `Tweet text invalid (${textCheck.length}/280 weighted chars)`);
    }

    const engagementMode = context.engagementMode || 'reply';
    const chainInfo = s.contexts.getEffectiveReplyTargetId(context);
    const replyToTweetId = engagementMode === 'reply' ? chainInfo.targetTweetId : undefined;
    const quoteTweetId = engagementMode === 'quote' ? context.targetTweetId : undefined;
    const isDryRun =
      s.settings.isGlobalDryRun() ||
      !!options.forceDryRun ||
      (options.forceLive ? false : (context.dryRun ?? false));
    // The campaign's own X account signs every request of this drop (default: the env account).
    const accountId = context.accountId || undefined;
    const accountHandle = s.accounts.handleOf(accountId);
    const accountCreds = s.accounts.getCredentialsForAccount(accountId);
    // A simulation never reaches X, so it does not need usable account tokens.
    const creds: Creds = accountCreds ?? {};
    const accountFailure = !isDryRun && !accountCreds;

    console.log(
      `[Drop] Executing drop for context "${context.name}" (${context.id}) ` +
        `-> Mode: ${engagementMode.toUpperCase()} ` +
        `${describeMode(context, engagementMode, replyToTweetId, chainInfo)}` +
        `, source: ${source}, mode: ${isDryRun ? 'DRY-RUN' : 'LIVE X'}${s.settings.isGlobalDryRun() ? ' (global dry-run)' : ''}` +
        `, account: ${accountHandle ? `@${accountHandle}` : (accountId ?? DEFAULT_ACCOUNT_ID)}`,
    );

    // An unusable account fails the drop without calling X (and pauses the campaign at once).
    let res: TweetResult = accountFailure
      ? { success: false, error: s.accounts.problem(accountId) ?? 'X account unavailable' }
      : await deps.postColorTweet(
          creds,
          { text, replyToTweetId, quoteTweetId, engagementMode, accountHandle },
          isDryRun,
        );
    if (
      !accountFailure &&
      !res.success &&
      engagementMode === 'reply' &&
      context.replyTargetMode === 'last_comment' &&
      !chainInfo.isFirstInChain
    ) {
      res = await recoverChain(context, res, text, replyToTweetId, creds, isDryRun, accountHandle);
    }
    let fallbackTriggered = false;
    if (
      !accountFailure &&
      !res.success &&
      engagementMode === 'reply' &&
      context.autoFallbackToQuote
    ) {
      const quoted = await quoteFallback(context, res, text, creds, isDryRun, accountHandle);
      if (quoted) {
        res = quoted;
        fallbackTriggered = true;
      }
    }
    recordTelemetry(res, isDryRun, accountId);
    const finalMode = fallbackTriggered ? 'quote' : engagementMode;

    const status = res.success ? (res.simulated ? 'simulated' : 'success') : 'error';
    const errorClass: XErrorClass | undefined = res.success
      ? undefined
      : accountFailure
        ? 'account'
        : classify(res);
    const failure = errorClass ? { errorClass, message: res.error } : undefined;
    // X rejected this account's tokens: mark it revoked so the UI and other campaigns know.
    if (errorClass === 'auth' && !isDryRun) s.accounts.markRevoked(accountId, res.error);
    const { autoPausedReason } = s.contexts.recordContextPostResult(
      context.id,
      status,
      res.tweetId,
      res.engagementMode || finalMode,
      failure,
    );
    const errorMessage =
      autoPausedReason && res.error
        ? `${res.error} [Campaign auto-paused: ${autoPausedReason}]`
        : res.error;
    const logEntry = {
      id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date().toISOString(),
      slotType,
      targetTweetId: context.targetTweetId,
      replyToTweetId: fallbackTriggered ? undefined : res.replyTo || replyToTweetId,
      quoteTweetId: res.quoteTweetId || (fallbackTriggered ? context.targetTweetId : quoteTweetId),
      engagementMode: res.engagementMode || finalMode,
      ...(fallbackTriggered ? { fallbackTriggered: true } : {}),
      color,
      tweetText: text,
      tweetId: res.tweetId,
      tweetUrl: res.url,
      status,
      errorMessage,
      contextId: context.id,
      contextName: context.name,
      accountId: accountId ?? DEFAULT_ACCOUNT_ID,
      ...(accountHandle ? { accountHandle } : {}),
    } as const;
    s.logs.addLog(logEntry);

    // Evolving hashtags advance only after a posted (live or simulated) drop, never on failure.
    let usedTags: string[] | undefined;
    if (isEvolutionEnabled(context)) {
      usedTags = usedHashtags(context, text, composed.hashtags);
      const next = res.success ? nextHashtagState(context, usedTags) : undefined;
      if (next) s.contexts.setHashtagState(context.id, next);
    }

    return {
      success: res.success,
      result: res,
      log: logEntry,
      context,
      ...(usedTags ? { hashtags: usedTags } : {}),
    };
  };

  return { executeDrop, composeText };
};

export type DropService = ReturnType<typeof createDropService>;

export const dropService: DropService = createDropService({
  services,
  postColorTweet,
  resolveTemplateText,
});
