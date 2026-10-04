/**
 * Pure helpers for a context's reply chain and jitter (no state, no persistence).
 */

import type { PostLog, TweetContext } from '../../shared/types.js';

const isQuoteLike = (l: PostLog) =>
  l.engagementMode === 'quote' || l.engagementMode === 'standalone' || !!l.quoteTweetId;

/**
 * Removes cross-campaign or quote-tweet chain pollution from a context (mutates it).
 * Returns true when anything changed.
 */
export const sanitizeContextChain = (ctx: TweetContext, logs: PostLog[]): boolean => {
  let modified = false;

  const quoteTweetIds = new Set(
    logs
      .filter((l) => isQuoteLike(l))
      .map((l) => l.tweetId)
      .filter(Boolean),
  );

  if (ctx.lastPostedTweetId) {
    const matchingLog = logs.find((l) => l.tweetId === ctx.lastPostedTweetId);
    const isPolluted =
      !/^\d+$/.test(ctx.lastPostedTweetId) ||
      quoteTweetIds.has(ctx.lastPostedTweetId) ||
      (matchingLog &&
        (matchingLog.engagementMode === 'quote' ||
          matchingLog.engagementMode === 'standalone' ||
          (matchingLog.contextId && matchingLog.contextId !== ctx.id) ||
          (matchingLog.targetTweetId && matchingLog.targetTweetId !== ctx.targetTweetId) ||
          (matchingLog.replyToTweetId && quoteTweetIds.has(matchingLog.replyToTweetId))));

    if (isPolluted) {
      const validReplyLogs = logs.filter(
        (l) =>
          l.contextId === ctx.id &&
          l.targetTweetId === ctx.targetTweetId &&
          l.status === 'success' &&
          l.engagementMode !== 'quote' &&
          l.engagementMode !== 'standalone' &&
          !l.quoteTweetId &&
          l.tweetId &&
          /^\d+$/.test(l.tweetId) &&
          (!l.replyToTweetId || !quoteTweetIds.has(l.replyToTweetId)),
      );
      ctx.lastPostedTweetId = validReplyLogs[validReplyLogs.length - 1]?.tweetId || undefined;
      modified = true;
    }
  }

  return modified;
};

/**
 * The most recent tweet ID posted by us for this context, strictly verified to belong to
 * the context's reply chain (not a quote/standalone post).
 */
export const resolveLastPostedTweetId = (
  context: TweetContext | undefined,
  logs: PostLog[],
): string | undefined => {
  if (!context || context.replyTargetMode !== 'last_comment') return undefined;
  const candidateId = context.lastPostedTweetId;
  if (!candidateId || !/^\d+$/.test(candidateId)) return undefined;

  const matchingLog = logs.find((l) => l.tweetId === candidateId);
  if (
    matchingLog &&
    (isQuoteLike(matchingLog) ||
      (matchingLog.contextId && matchingLog.contextId !== context.id) ||
      (matchingLog.targetTweetId && matchingLog.targetTweetId !== context.targetTweetId))
  ) {
    return undefined;
  }
  return candidateId;
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
