/**
 * Drop service for X ChromaBot.
 * The single code path that composes and posts one drop (template -> X -> telemetry -> log).
 * Used by the scheduler tick, manual post/trigger routes, the webhook and the CLI.
 * It knows nothing about timers; X and Gemini are injected so tests can stub them.
 */

import type { ColorData, TweetContext } from '../../shared/types.js';
import { hourInZone, slotTypeForHour } from '../../shared/time.js';
import { checkTweetText } from '../../shared/tweetLength.js';
import { HttpError } from '../middleware/error.js';
import { resolveTemplateText } from '../templateAgent.js';
import { postColorTweet } from '../twitterClient.js';
import { services, type Services } from './index.js';

export interface ExecuteDropOptions {
  contextId?: string;
  slotType?: 'morning' | 'evening' | 'manual';
  color?: ColorData;
  forceLive?: boolean;
  /** Exact text to post (e.g. the previewed text); skips template resolution. Still length-checked. */
  text?: string;
  source?: 'scheduler' | 'webhook' | 'manual' | 'cli';
}

export interface DropDeps {
  services: Pick<Services, 'contexts' | 'queue' | 'logs' | 'credentials' | 'rateLimit'>;
  postColorTweet: typeof postColorTweet;
  resolveTemplateText: typeof resolveTemplateText;
}

type TweetResult = Awaited<ReturnType<typeof postColorTweet>>;
type Creds = ReturnType<Services['credentials']['getEffectiveCredentials']>;

/** Rate-limit / cooldown responses: set the global cooldown. */
const isCooldown = (r: TweetResult) =>
  !!(
    r.isRateLimitOrCooldown ||
    r.rawResponse?.status === 429 ||
    r.error?.includes('cooldown') ||
    r.error?.includes('not permitted to access this feature')
  );

/** Temporary failures where the chain anchor must be kept (superset of cooldown). */
const isTemporaryFailure = (r: TweetResult) =>
  isCooldown(r) ||
  !!(r.error?.includes('Credits Depleted') || r.error?.includes('Payment Required'));

export const createDropService = (deps: DropDeps) => {
  const s = deps.services;

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

  /** Retry once on the root post when a cascading reply failed because the anchor is gone. */
  const recoverChain = async (
    context: TweetContext,
    first: TweetResult,
    text: string,
    replyTo: string | undefined,
    creds: Creds,
    isDryRun: boolean,
  ): Promise<TweetResult> => {
    if (isTemporaryFailure(first)) {
      console.log(
        `[Drop] Preserving chain anchor #${replyTo} for context "${context.name}" during temporary X cooldown.`,
      );
      return first;
    }
    console.log(
      `[Drop] Cascading anchor #${replyTo} for context "${context.name}" appears deleted or invalid (${first.error}). Resetting anchor to primary root post #${context.targetTweetId}.`,
    );
    context.lastPostedTweetId = undefined;
    s.contexts.resetContextChain(context.id);
    if (isDryRun) return first;
    const fallback = await deps.postColorTweet(
      creds,
      { text, replyToTweetId: context.targetTweetId, engagementMode: 'reply' },
      isDryRun,
    );
    return fallback.success ? fallback : first;
  };

  const recordTelemetry = (res: TweetResult, isDryRun: boolean) => {
    if (res.rateLimitHeaders) s.rateLimit.updateRateLimitTelemetry(res.rateLimitHeaders);
    if (!isDryRun && isCooldown(res)) {
      s.rateLimit.setGlobalCooldown(15, res.error || 'X API Rate Limit / Reply Cooldown Active');
    }
    if (!isDryRun && res.success) s.rateLimit.recordLivePostTimestamp();
  };

  /** Execute a drop for a specific context or the active context. */
  const executeDrop = async (options: ExecuteDropOptions = {}) => {
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
    const text =
      options.text ??
      (await deps.resolveTemplateText(context.template, color, {
        slotLabel: isMorning ? '6:00 AM' : '6:00 PM',
        contextId: context.id,
        targetTweetId: context.targetTweetId,
      }));
    const textCheck = checkTweetText(text);
    if (!textCheck.ok) {
      throw new HttpError(400, `Tweet text invalid (${textCheck.length}/280 weighted chars)`);
    }

    const engagementMode = context.engagementMode || 'reply';
    const chainInfo = s.contexts.getEffectiveReplyTargetId(context);
    const replyToTweetId = engagementMode === 'reply' ? chainInfo.targetTweetId : undefined;
    const quoteTweetId = engagementMode === 'quote' ? context.targetTweetId : undefined;
    const isDryRun = options.forceLive ? false : (context.dryRun ?? false);
    const creds = s.credentials.getEffectiveCredentials();

    console.log(
      `[Drop] Executing drop for context "${context.name}" (${context.id}) ` +
        `-> Mode: ${engagementMode.toUpperCase()} ` +
        `${describeMode(context, engagementMode, replyToTweetId, chainInfo)}` +
        `, source: ${options.source || 'manual'}, mode: ${isDryRun ? 'DRY-RUN' : 'LIVE X'}`,
    );

    let res = await deps.postColorTweet(
      creds,
      { text, replyToTweetId, quoteTweetId, engagementMode },
      isDryRun,
    );
    if (
      !res.success &&
      engagementMode === 'reply' &&
      context.replyTargetMode === 'last_comment' &&
      !chainInfo.isFirstInChain
    ) {
      res = await recoverChain(context, res, text, replyToTweetId, creds, isDryRun);
    }
    recordTelemetry(res, isDryRun);

    const status = res.success ? (res.simulated ? 'simulated' : 'success') : 'error';
    s.contexts.recordContextPostResult(
      context.id,
      status,
      res.tweetId,
      res.engagementMode || engagementMode,
    );
    const logEntry = {
      id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date().toISOString(),
      slotType,
      targetTweetId: context.targetTweetId,
      replyToTweetId: res.replyTo || replyToTweetId,
      quoteTweetId: res.quoteTweetId || quoteTweetId,
      engagementMode: res.engagementMode || engagementMode,
      color,
      tweetText: text,
      tweetId: res.tweetId,
      tweetUrl: res.url,
      status,
      errorMessage: res.error,
      contextId: context.id,
      contextName: context.name,
    } as const;
    s.logs.addLog(logEntry);

    return { success: res.success, result: res, log: logEntry, context };
  };

  return { executeDrop };
};

export type DropService = ReturnType<typeof createDropService>;

export const dropService: DropService = createDropService({
  services,
  postColorTweet,
  resolveTemplateText,
});
