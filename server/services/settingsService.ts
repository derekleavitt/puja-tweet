/**
 * Legacy global settings view, backed by one campaign (the active one unless an id is given).
 * The two real global switches (`globalDryRun`, `globalPaused`) are the only stored settings.
 */

import type { BotSettings, TweetContext, TweetContextSchedule } from '../../shared/types.js';
import { HttpError } from '../middleware/error.js';
import type { ContextService } from './contextService.js';
import { buildSettingsView } from './settingsMirror.js';
import type { StateManager } from './stateManager.js';

/** The campaign-level fields of the legacy settings body, plus the campaign they apply to. */
export type SettingsUpdate = Partial<BotSettings> & { contextId?: string };

export class SettingsService {
  constructor(
    private readonly sm: StateManager,
    private readonly contexts: ContextService,
  ) {}

  /** Unknown ids are a 404 (never a silent fallback to the active campaign). */
  private resolve(contextId?: string): TweetContext {
    if (!contextId) return this.contexts.getActiveContext();
    const found = this.contexts.getContext(contextId);
    if (!found) throw new HttpError(404, `Context ${contextId} not found`);
    return found;
  }

  getSettings(contextId?: string): BotSettings {
    return buildSettingsView(this.resolve(contextId), this.sm.state.settings);
  }

  /** Global dry-run overrides every campaign and every path; unset (legacy stores) means on. */
  isGlobalDryRun(): boolean {
    return this.sm.state.settings.globalDryRun !== false;
  }

  /** Global pause stops scheduled drops (scheduler, webhook, CLI); unset (legacy stores) means on. */
  isGlobalPaused(): boolean {
    return this.sm.state.settings.globalPaused !== false;
  }

  /**
   * Applies the campaign-level fields to `newSettings.contextId` (default: the active campaign) and
   * the global switches to the global state. Never touches any other campaign.
   */
  updateSettings(newSettings: SettingsUpdate): BotSettings {
    const active = this.resolve(newSettings.contextId);
    const schedule: Partial<TweetContextSchedule> = {};
    if (newSettings.intervalMode) schedule.mode = newSettings.intervalMode;
    if (newSettings.intervalMinutes) schedule.intervalMinutes = newSettings.intervalMinutes;
    if (newSettings.scheduleTimes) schedule.scheduleTimes = newSettings.scheduleTimes;
    if (newSettings.timezone) schedule.timezone = newSettings.timezone;
    if (newSettings.humanizeJitterEnabled !== undefined)
      schedule.humanizeJitterEnabled = newSettings.humanizeJitterEnabled;
    if (newSettings.jitterPercentage !== undefined)
      schedule.jitterPercentage = newSettings.jitterPercentage;

    // Built as a client-style body: `updateContext` validates it like a PUT /api/contexts/:id.
    const updates: Record<string, unknown> = {};
    if (newSettings.targetTweetId) updates.targetTweetId = newSettings.targetTweetId;
    if (newSettings.replyTargetMode) updates.replyTargetMode = newSettings.replyTargetMode;
    if (newSettings.engagementMode) updates.engagementMode = newSettings.engagementMode;
    if (newSettings.autoFallbackToQuote !== undefined)
      updates.autoFallbackToQuote = newSettings.autoFallbackToQuote;
    // The chain anchor is server-owned: only an explicit reset (null / '') is honoured
    // (`updateContext` ignores any string value).
    if ('lastPostedTweetId' in newSettings && !newSettings.lastPostedTweetId) {
      updates.lastPostedTweetId = null;
    }
    if (newSettings.schedulerEnabled !== undefined) updates.enabled = newSettings.schedulerEnabled;
    if (newSettings.dryRun !== undefined) updates.dryRun = newSettings.dryRun;
    if (newSettings.template) updates.template = newSettings.template;
    if (newSettings.themePreference) updates.themePreference = newSettings.themePreference;
    if (Object.keys(schedule).length > 0) updates.schedule = { ...active.schedule, ...schedule };

    if (typeof newSettings.globalDryRun === 'boolean') {
      this.sm.state.settings.globalDryRun = newSettings.globalDryRun;
    }
    if (typeof newSettings.globalPaused === 'boolean') {
      this.sm.state.settings.globalPaused = newSettings.globalPaused;
    }
    this.sm.persist();

    // A global-only toggle never touches (or regenerates the queue of) any campaign.
    if (Object.keys(updates).length > 0) this.contexts.updateContext(active.id, updates);
    return this.getSettings(active.id);
  }
}
