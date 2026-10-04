/**
 * Default bot state and normalisation of raw persisted data (shared by every Store).
 */

import { DEFAULT_TWEET_TEMPLATE } from '../colorEngine.js';
import type { BotSettings } from '../../shared/types.js';
import type { BotState } from './Store.js';

export const createDefaultSettings = (): BotSettings => ({
  targetTweetId: process.env.TARGET_TWEET_ID || '2091597504928428416',
  scheduleTimes: (process.env.SCHEDULE_TIMES || '06:00,18:00').split(',').map((s) => s.trim()),
  timezone: process.env.SCHEDULE_TIMEZONE || 'America/Denver',
  schedulerEnabled: true,
  dryRun: false,
  globalDryRun: true,
  globalPaused: true,
  template: DEFAULT_TWEET_TEMPLATE,
  themePreference: 'dynamic',
  intervalMode: 'interval',
  intervalMinutes: 15,
  humanizeJitterEnabled: true,
  jitterPercentage: 25,
  activeContextId: 'ctx_primary',
});

export const createDefaultState = (): BotState => ({
  settings: createDefaultSettings(),
  contexts: [],
  activeContextId: 'ctx_primary',
  logs: [],
  queue: [],
  credentials: {},
  cooldownUntilMs: 0,
  cooldownReason: '',
  lastThrottledAt: '',
  lastGlobalLivePostTimestamp: 0,
});

/** Merges loosely-typed persisted data (e.g. a parsed JSON file) over the defaults. */
export const normalizeState = (raw: unknown): BotState => {
  const state = createDefaultState();
  if (!raw || typeof raw !== 'object') return state;
  const data = raw as Record<string, any>;

  if (data.settings) state.settings = { ...state.settings, ...data.settings };
  if (Array.isArray(data.contexts) && data.contexts.length > 0) state.contexts = data.contexts;
  if (data.activeContextId) state.activeContextId = data.activeContextId;
  if (Array.isArray(data.logs)) state.logs = data.logs;
  if (Array.isArray(data.queue)) state.queue = data.queue;
  if (data.credentials) state.credentials = data.credentials;
  if (data.cooldownUntilMs) state.cooldownUntilMs = Number(data.cooldownUntilMs);
  if (data.cooldownReason) state.cooldownReason = data.cooldownReason;
  if (data.lastThrottledAt) state.lastThrottledAt = data.lastThrottledAt;
  if (data.lastGlobalLivePostTimestamp) {
    state.lastGlobalLivePostTimestamp = Number(data.lastGlobalLivePostTimestamp);
  }
  if (data.lastCapturedRateLimitHeaders) {
    state.lastCapturedRateLimitHeaders = data.lastCapturedRateLimitHeaders;
  }
  if (data.lastRateLimitCaptureTimestamp) {
    state.lastRateLimitCaptureTimestamp = Number(data.lastRateLimitCaptureTimestamp);
  }
  return state;
};
