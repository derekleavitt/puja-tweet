/**
 * Legacy global settings view, backed by the active context.
 */

import type { BotSettings, TweetContext, TweetContextSchedule } from '../../shared/types.js';
import type { ContextService } from './contextService.js';
import { buildSettingsView } from './settingsMirror.js';
import type { StateManager } from './stateManager.js';

export class SettingsService {
  constructor(
    private readonly sm: StateManager,
    private readonly contexts: ContextService,
  ) {}

  getSettings(): BotSettings {
    return buildSettingsView(this.contexts.getActiveContext(), this.sm.state.settings);
  }

  updateSettings(newSettings: Partial<BotSettings>): BotSettings {
    const active = this.contexts.getActiveContext();
    const schedule: Partial<TweetContextSchedule> = {};
    if (newSettings.intervalMode) schedule.mode = newSettings.intervalMode;
    if (newSettings.intervalMinutes) schedule.intervalMinutes = newSettings.intervalMinutes;
    if (newSettings.scheduleTimes) schedule.scheduleTimes = newSettings.scheduleTimes;
    if (newSettings.timezone) schedule.timezone = newSettings.timezone;
    if (newSettings.humanizeJitterEnabled !== undefined)
      schedule.humanizeJitterEnabled = newSettings.humanizeJitterEnabled;
    if (newSettings.jitterPercentage !== undefined)
      schedule.jitterPercentage = newSettings.jitterPercentage;

    const updates: Partial<TweetContext> = {};
    if (newSettings.targetTweetId) updates.targetTweetId = newSettings.targetTweetId;
    if (newSettings.replyTargetMode) updates.replyTargetMode = newSettings.replyTargetMode;
    if (newSettings.engagementMode) updates.engagementMode = newSettings.engagementMode;
    if (newSettings.autoFallbackToQuote !== undefined)
      updates.autoFallbackToQuote = newSettings.autoFallbackToQuote;
    if (newSettings.lastPostedTweetId !== undefined)
      updates.lastPostedTweetId = newSettings.lastPostedTweetId;
    if (newSettings.schedulerEnabled !== undefined) updates.enabled = newSettings.schedulerEnabled;
    if (newSettings.dryRun !== undefined) updates.dryRun = newSettings.dryRun;
    if (newSettings.template) updates.template = newSettings.template;
    if (newSettings.themePreference) updates.themePreference = newSettings.themePreference;
    if (Object.keys(schedule).length > 0) updates.schedule = { ...active.schedule, ...schedule };

    this.contexts.updateContext(active.id, updates);
    return this.getSettings();
  }
}
