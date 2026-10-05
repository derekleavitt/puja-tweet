/**
 * The first-run primary context, seeded from the legacy global settings.
 */

import { DEFAULT_TWEET_TEMPLATE } from '../colorEngine.js';
import { DEFAULT_HASHTAG_EVOLUTION } from '../../shared/hashtags/index.js';
import type { TweetContext } from '../../shared/types.js';
import type { BotState } from '../store/Store.js';
import { getDefaultTargetTweetId } from '../store/defaults.js';

export const buildPrimaryContext = (s: BotState): TweetContext => {
  const now = new Date().toISOString();
  return {
    id: 'ctx_primary',
    name: 'Primary Eternal Colors',
    description: 'Main automated color palette reply thread on X',
    targetTweetId: s.settings.targetTweetId || getDefaultTargetTweetId(),
    replyTargetMode: 'original_post',
    lastPostedTweetId: undefined,
    enabled: s.settings.schedulerEnabled ?? true,
    dryRun: s.settings.dryRun ?? false,
    schedule: {
      mode: s.settings.intervalMode || 'interval',
      intervalMinutes: s.settings.intervalMinutes || 1,
      scheduleTimes: s.settings.scheduleTimes || ['06:00', '18:00'],
      timezone: s.settings.timezone || 'America/Denver',
      humanizeJitterEnabled: s.settings.humanizeJitterEnabled ?? true,
      jitterPercentage: s.settings.jitterPercentage ?? 25,
    },
    template: s.settings.template || DEFAULT_TWEET_TEMPLATE,
    themePreference: s.settings.themePreference || 'dynamic',
    hashtagEvolution: { ...DEFAULT_HASHTAG_EVOLUTION },
    lastPostedTimestamp: Date.now(),
    currentJitterMs: 0,
    createdAt: now,
    updatedAt: now,
    stats: {
      totalPosts: s.logs.length,
      successfulPosts: s.logs.filter((l) => l.status === 'success').length,
      simulatedPosts: s.logs.filter((l) => l.status === 'simulated').length,
      failedPosts: s.logs.filter((l) => l.status === 'error').length,
    },
  };
};
