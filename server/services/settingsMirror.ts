/**
 * Mirrors the active context into the legacy global `BotSettings` shape.
 */

import type { BotSettings, TweetContext } from '../../shared/types.js';

/** Copies the active context's fields onto the stored settings object (mutates `settings`). */
export const syncActiveContextToSettings = (settings: BotSettings, ctx: TweetContext) => {
  settings.targetTweetId = ctx.targetTweetId;
  settings.replyTargetMode = ctx.replyTargetMode || 'original_post';
  settings.engagementMode = ctx.engagementMode || 'reply';
  settings.autoFallbackToQuote = ctx.autoFallbackToQuote ?? true;
  settings.lastPostedTweetId = ctx.lastPostedTweetId;
  settings.schedulerEnabled = ctx.enabled;
  settings.dryRun = ctx.dryRun ?? false;
  settings.template = ctx.template;
  settings.themePreference = ctx.themePreference;
  settings.intervalMode = ctx.schedule.mode;
  settings.intervalMinutes = ctx.schedule.intervalMinutes;
  settings.scheduleTimes = ctx.schedule.scheduleTimes;
  settings.timezone = ctx.schedule.timezone;
  settings.humanizeJitterEnabled = ctx.schedule.humanizeJitterEnabled;
  settings.jitterPercentage = ctx.schedule.jitterPercentage;
  settings.activeContextId = ctx.id;
};

/** The public settings view (never includes the webhook secret). */
export const buildSettingsView = (active: TweetContext, stored: BotSettings): BotSettings => ({
  targetTweetId: active.targetTweetId,
  replyTargetMode: active.replyTargetMode || 'original_post',
  engagementMode: active.engagementMode || 'reply',
  autoFallbackToQuote: active.autoFallbackToQuote ?? true,
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
