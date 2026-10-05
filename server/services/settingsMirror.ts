/**
 * The legacy global `BotSettings` view, computed from ONE campaign on every read.
 * Nothing is ever mirrored back into the stored `settings` object: the only global fields that live
 * there are `globalDryRun` / `globalPaused` (and the first-run seed read by `primaryContext.ts`).
 * Campaign fields are read from the campaign, so no campaign's values can leak into another's.
 */

import type { BotSettings, TweetContext } from '../../shared/types.js';

/**
 * The public settings view of `active` (never includes the webhook secret). Without any campaign it
 * is the stored first-run defaults plus the global switches.
 */
export const buildSettingsView = (
  active: TweetContext | undefined,
  stored: BotSettings,
): BotSettings => {
  if (!active) {
    const { webhookSecret: _secret, ...rest } = stored;
    return {
      ...rest,
      globalDryRun: stored.globalDryRun !== false,
      globalPaused: stored.globalPaused !== false,
      activeContextId: '',
    };
  }
  return campaignView(active, stored);
};

const campaignView = (active: TweetContext, stored: BotSettings): BotSettings => ({
  targetTweetId: active.targetTweetId,
  replyTargetMode: active.replyTargetMode || 'original_post',
  engagementMode: active.engagementMode || 'reply',
  autoFallbackToQuote: active.autoFallbackToQuote ?? false,
  lastPostedTweetId: active.lastPostedTweetId,
  scheduleTimes: active.schedule.scheduleTimes,
  timezone: active.schedule.timezone,
  schedulerEnabled: active.enabled,
  dryRun: active.dryRun ?? stored.dryRun,
  globalDryRun: stored.globalDryRun !== false,
  globalPaused: stored.globalPaused !== false,
  template: active.template,
  themePreference: active.themePreference,
  intervalMode: active.schedule.mode,
  intervalMinutes: active.schedule.intervalMinutes,
  humanizeJitterEnabled: active.schedule.humanizeJitterEnabled,
  jitterPercentage: active.schedule.jitterPercentage,
  activeContextId: active.id,
});
