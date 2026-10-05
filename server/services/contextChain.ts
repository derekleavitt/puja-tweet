/**
 * Pure helpers for a context's reply chain and jitter (no state, no persistence).
 *
 * Chain anchors are verified against the campaign's own `chainAnchor` provenance (written only by
 * `recordContextPostResult` for this campaign's own live in-thread reply on its own target), never
 * against the shared post log alone: logs are capped (MAX_LOGS) across all campaigns, so a paused
 * campaign's anchor log can be trimmed while other campaigns keep posting. Logs are only used as
 * extra pollution evidence when a matching entry still exists.
 */

import type { ChainAnchor, PostLog, TweetContext } from '../../shared/types.js';

const isNumericId = (id: string | undefined): id is string => !!id && /^\d+$/.test(id);

const isQuoteLike = (l: PostLog) =>
  l.engagementMode === 'quote' || l.engagementMode === 'standalone' || !!l.quoteTweetId;

/** A log entry proving that `tweetId` was this campaign's own live in-thread reply on `target`. */
const isProvingLog = (l: PostLog, ctxId: string, target: string, tweetId: string) =>
  l.tweetId === tweetId &&
  l.contextId === ctxId &&
  l.targetTweetId === target &&
  l.status === 'success' &&
  !isQuoteLike(l);

/** A log entry that contradicts the anchor (another campaign's tweet, a quote, a failure…). */
const isContradictingLog = (l: PostLog, ctxId: string, target: string) =>
  l.contextId !== ctxId || l.targetTweetId !== target || l.status !== 'success' || isQuoteLike(l);

/**
 * The verified anchor of `ctx`, or undefined when there is none (chain restarts at the root).
 * Verification order:
 *  1. `chainAnchor` provenance must exist, match `lastPostedTweetId` and the current target.
 *  2. If the shared log still has that tweet, it must not contradict the provenance.
 */
export const verifiedChainAnchor = (
  ctx: Pick<TweetContext, 'id' | 'targetTweetId' | 'lastPostedTweetId' | 'chainAnchor'>,
  logs: PostLog[],
): ChainAnchor | undefined => {
  const anchor = ctx.chainAnchor;
  const tweetId = ctx.lastPostedTweetId;
  if (!anchor || !isNumericId(tweetId) || anchor.tweetId !== tweetId) return undefined;
  if (anchor.targetTweetId !== ctx.targetTweetId) return undefined;
  const matchingLog = logs.find((l) => l.tweetId === tweetId);
  if (matchingLog && isContradictingLog(matchingLog, ctx.id, ctx.targetTweetId)) return undefined;
  return anchor;
};

/**
 * Repairs a context's chain state (mutates it). Returns true when anything changed.
 *  - A legacy anchor (`lastPostedTweetId` without `chainAnchor`) is upgraded to provenance when a
 *    log still proves it; otherwise it is unverified and dropped (the chain restarts at the root).
 *  - An anchor whose provenance is stale (other target) or contradicted by the log is dropped.
 */
export const sanitizeContextChain = (ctx: TweetContext, logs: PostLog[]): boolean => {
  const tweetId = ctx.lastPostedTweetId;
  if (!tweetId && !ctx.chainAnchor) return false;

  if (!ctx.chainAnchor && isNumericId(tweetId)) {
    const proof = logs.find((l) => isProvingLog(l, ctx.id, ctx.targetTweetId, tweetId));
    if (proof) {
      ctx.chainAnchor = { tweetId, targetTweetId: ctx.targetTweetId, postedAt: proof.timestamp };
      return true;
    }
  }
  if (verifiedChainAnchor(ctx, logs)) return false;

  ctx.lastPostedTweetId = undefined;
  ctx.chainAnchor = undefined;
  return true;
};

/**
 * The most recent tweet ID posted by us for this context, strictly verified to belong to
 * the context's own reply chain on its current target.
 */
export const resolveLastPostedTweetId = (
  context: TweetContext | undefined,
  logs: PostLog[],
): string | undefined => {
  if (!context || context.replyTargetMode !== 'last_comment') return undefined;
  return verifiedChainAnchor(context, logs)?.tweetId;
};

export interface EffectiveReplyTarget {
  targetTweetId: string;
  isCascadingToLastComment: boolean;
  isFirstInChain: boolean;
}

/** The effective tweet to reply to based on the context's `replyTargetMode`. */
export const resolveReplyTarget = (
  context: TweetContext,
  logs: PostLog[],
): EffectiveReplyTarget => {
  if (context.replyTargetMode === 'last_comment') {
    const lastTweetId = resolveLastPostedTweetId(context, logs);
    if (lastTweetId) {
      return { targetTweetId: lastTweetId, isCascadingToLastComment: true, isFirstInChain: false };
    }
    // No prior comment yet: reply to the root target to start the chain
    return {
      targetTweetId: context.targetTweetId,
      isCascadingToLastComment: true,
      isFirstInChain: true,
    };
  }
  return {
    targetTweetId: context.targetTweetId,
    isCascadingToLastComment: false,
    isFirstInChain: false,
  };
};

/** Picks a fresh random humanizing delay for the context (mutates `currentJitterMs`). */
export const generateJitterForContext = (context: TweetContext): number => {
  if (!context.schedule.humanizeJitterEnabled) {
    context.currentJitterMs = 0;
    return 0;
  }
  const intervalMinutes = context.schedule.intervalMinutes || 60;
  // Short intervals are already frequent; random delay there only makes posts skip whole ticks.
  if (context.schedule.mode === 'interval' && intervalMinutes < 5) {
    context.currentJitterMs = 0;
    return 0;
  }
  const windowMs =
    context.schedule.mode === 'interval'
      ? intervalMinutes * 60 * 1000
      : context.schedule.scheduleTimes.length > 1
        ? (24 / context.schedule.scheduleTimes.length) * 3600 * 1000
        : 12 * 3600 * 1000;

  const maxPercent = (context.schedule.jitterPercentage ?? 25) / 100;
  const maxJitterMs = Math.floor(windowMs * maxPercent);
  const randomJitter = Math.floor(Math.random() * (maxJitterMs + 1));
  context.currentJitterMs = randomJitter;
  return randomJitter;
};
