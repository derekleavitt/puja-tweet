/**
 * Drop service for X ChromaBot.
 * The single code path that composes and posts one drop (template -> X -> telemetry -> log).
 * Used by the scheduler tick, manual post/trigger routes, the webhook and the CLI.
 * It knows nothing about timers; X and Gemini are injected so tests can stub them.
 */

import type { ColorData, PostLog, TweetContext } from '../../shared/types.js';
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
import { buildTurn, type ConversationTurn } from './conversationService.js';
import { services, type Services } from './index.js';
import { generateColor } from '../colorEngine.js';

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
  /**
   * Conversation campaigns with `text`: the preview's turn, echoed back so a stale preview is
   * refused (409) instead of posting out of order.
   */
  conversation?: {
    runId: string;
    turnNumber: number;
    speakerAccountId: string;
    nextSpeakerAccountId: string;
  };
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

export interface DropResult {
  success: boolean;
  result: TweetResult;
  log: PostLog;
  context: TweetContext;
  hashtags?: string[];
}

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

  /** Cooldown, live-post spacing and the rate window are per X account (headers are per user). */
  const recordTelemetry = (res: TweetResult, isDryRun: boolean, accountId?: string) => {
    if (res.rateLimitHeaders) s.rateLimit.updateRateLimitTelemetry(res.rateLimitHeaders, accountId);
    if (!isDryRun && isCooldown(res)) {
      s.rateLimit.setCooldown(
        15,
        res.error || 'X API Rate Limit / Reply Cooldown Active',
        accountId,
      );
    }
    if (!isDryRun && res.success) s.rateLimit.recordLivePostTimestamp(accountId);
  };

  /** Campaigns with a drop in progress: one drop per campaign at a time (tick vs. post-now race). */
  const inFlight = new Set<string>();

  /** The text must address the next speaker (X only lets an app reply when mentioned). */
  const mentions = (text: string, handle: string) =>
    new RegExp(`(^|[^\\w])@${handle}\\b`, 'i').test(text);

  /** One conversation turn: the speaker's own account posts, then the shared state advances. */
  const executeConversationDrop = async (
    options: ExecuteDropOptions,
    context: TweetContext,
    source: string,
  ): Promise<DropResult> => {
    const state = context.conversationState;
    if (!context.conversation || !state) {
      throw new HttpError(400, `"${context.name}" has no conversation state.`);
    }
    const isDryRun =
      s.settings.isGlobalDryRun() ||
      !!options.forceDryRun ||
      (options.forceLive ? false : (context.dryRun ?? false));
    const slotType = options.slotType || 'manual';
    const chainInfo = s.contexts.getEffectiveReplyTargetId(context);

    let turn: ConversationTurn | undefined;
    let turnError: unknown;
    if (options.text !== undefined) {
      const echo = options.conversation;
      if (!echo) throw new HttpError(400, 'conversation turn details are required with text');
      if (
        echo.runId !== state.runId ||
        echo.turnNumber !== state.turnCount + 1 ||
        echo.speakerAccountId !== state.nextSpeakerAccountId
      ) {
        throw new HttpError(409, 'Conversation moved on, refresh the preview');
      }
      const cast = context.conversation.participants.map((p) => p.accountId);
      if (
        !cast.includes(echo.nextSpeakerAccountId) ||
        echo.nextSpeakerAccountId === echo.speakerAccountId
      ) {
        throw new HttpError(400, 'nextSpeakerAccountId must be another participant');
      }
      const nextHandle = s.accounts.handleOf(echo.nextSpeakerAccountId);
      if (!nextHandle) throw new HttpError(400, 'Verify the next speaker account first');
      if (!mentions(options.text, nextHandle)) {
        throw new HttpError(400, `The reply must mention @${nextHandle} (the next speaker)`);
      }
      turn = {
        runId: state.runId,
        turnNumber: echo.turnNumber,
        speakerAccountId: echo.speakerAccountId,
        speakerHandle: s.accounts.handleOf(echo.speakerAccountId) ?? '',
        nextSpeakerAccountId: echo.nextSpeakerAccountId,
        nextSpeakerHandle: nextHandle,
        text: options.text,
        replyToTweetId: chainInfo.targetTweetId,
        summaryUsed: false,
        transcriptLength: 0,
      };
    } else {
      try {
        turn = await buildTurn(context);
      } catch (err) {
        turnError = err;
      }
    }

    const speakerAccountId = turn?.speakerAccountId ?? state.nextSpeakerAccountId;
    const accountHandle = s.accounts.handleOf(speakerAccountId);
    const accountCreds = s.accounts.getCredentialsForAccount(speakerAccountId);
    const creds: Creds = accountCreds ?? {};
    const accountFailure = !turnError && !isDryRun && !accountCreds;
    const text = turn?.text ?? '';
    if (turn) {
      const check = checkTweetText(text);
      if (!check.ok) {
        throw new HttpError(400, `Tweet text invalid (${check.length}/280 weighted chars)`);
      }
    }

    console.log(
      `[Drop] Executing conversation turn ${turn?.turnNumber ?? state.turnCount + 1} for context ` +
        `"${context.name}" (${context.id}), source: ${source}, ` +
        `mode: ${isDryRun ? 'DRY-RUN' : 'LIVE X'}${s.settings.isGlobalDryRun() ? ' (global dry-run)' : ''}` +
        `, speaker: ${accountHandle ? `@${accountHandle}` : speakerAccountId}`,
    );

    const replyToTweetId = turn?.replyToTweetId;
    let res: TweetResult = turnError
      ? {
          success: false,
          error: turnError instanceof Error ? turnError.message : 'Conversation turn failed',
        }
      : accountFailure
        ? { success: false, error: s.accounts.problem(speakerAccountId) ?? 'X account unavailable' }
        : await deps.postColorTweet(
            creds,
            { text, replyToTweetId, engagementMode: 'reply', accountHandle },
            isDryRun,
          );
    if (!turnError && !accountFailure && !res.success && !chainInfo.isFirstInChain) {
      res = await recoverChain(context, res, text, replyToTweetId, creds, isDryRun, accountHandle);
    }
    // A failed AI turn never reached X, so it must not touch the speaker's X telemetry.
    if (!turnError) recordTelemetry(res, isDryRun, speakerAccountId);

    const status = res.success ? (res.simulated ? 'simulated' : 'success') : 'error';
    const errorClass: XErrorClass | undefined = res.success
      ? undefined
      : turnError
        ? 'unknown'
        : accountFailure
          ? 'account'
          : classify(res);
    const failure = errorClass ? { errorClass, message: res.error } : undefined;
    if (errorClass === 'auth' && !isDryRun) s.accounts.markRevoked(speakerAccountId, res.error);
    const posted = s.contexts.recordContextPostResult(
      context.id,
      status,
      res.tweetId,
      'reply',
      failure,
    );
    let autoPausedReason = posted.autoPausedReason;
    if (turn && status !== 'error') {
      autoPausedReason =
        s.contexts.recordConversationTurn(context.id, turn, status).autoPausedReason ??
        autoPausedReason;
    }
    const errorMessage =
      autoPausedReason && res.error
        ? `${res.error} [Campaign auto-paused: ${autoPausedReason}]`
        : res.error;
    const logEntry = {
      id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date().toISOString(),
      slotType,
      targetTweetId: context.targetTweetId,
      replyToTweetId: res.replyTo || replyToTweetId,
      engagementMode: 'reply',
      color: generateColor(slotType === 'morning' ? 'morning' : 'evening'),
      tweetText: text,
      tweetId: res.tweetId,
      tweetUrl: res.url,
      status,
      errorMessage,
      contextId: context.id,
      contextName: context.name,
      accountId: speakerAccountId,
      ...(accountHandle ? { accountHandle } : {}),
      conversationRunId: state.runId,
      turn: turn?.turnNumber ?? state.turnCount + 1,
      nextSpeakerAccountId: turn?.nextSpeakerAccountId,
    } as const;
    s.logs.addLog(logEntry);

    return { success: res.success, result: res, log: logEntry, context };
  };

  /** Execute a drop for a specific context or the active context. */
  const executeDrop = async (options: ExecuteDropOptions = {}): Promise<DropResult> => {
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
    if (inFlight.has(context.id)) {
      throw new HttpError(409, 'A drop for this campaign is already running');
    }
    inFlight.add(context.id);
    try {
      if (context.mode === 'conversation') {
        return await executeConversationDrop(options, context, source);
      }
      return await executeSingleDrop(options, context, source);
    } finally {
      inFlight.delete(context.id);
    }
  };

  const executeSingleDrop = async (
    options: ExecuteDropOptions,
    context: TweetContext,
    source: string,
  ): Promise<DropResult> => {
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
