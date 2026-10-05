/**
 * Default bot state and normalisation of raw persisted data (shared by every Store).
 */

import { DEFAULT_TWEET_TEMPLATE } from '../colorEngine.js';
import type { BotSettings } from '../../shared/types.js';
import type { BotState } from './Store.js';

/** Single source of truth for the default target tweet ID (env TARGET_TWEET_ID; empty when unset). */
export const getDefaultTargetTweetId = (): string => (process.env.TARGET_TWEET_ID || '').trim();

export const createDefaultSettings = (): BotSettings => ({
  targetTweetId: getDefaultTargetTweetId(),
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
  accounts: [],
  pendingOAuth: [],
  cooldownUntilMs: 0,
  cooldownReason: '',
  lastThrottledAt: '',
  lastGlobalLivePostTimestamp: 0,
});

/** Merges loosely-typed persisted data (e.g. a parsed JSON file) over the defaults. */
export const normalizeState = (raw: unknown): BotState => {
  const state = createDefaultState();
  if (!raw || typeof raw !== 'object') return state;
  const data = raw as Partial<BotState>;

  if (data.settings) state.settings = { ...state.settings, ...data.settings };
  if (Array.isArray(data.contexts) && data.contexts.length > 0) state.contexts = data.contexts;
  if (data.activeContextId) state.activeContextId = data.activeContextId;
  if (Array.isArray(data.logs)) state.logs = data.logs;
  if (Array.isArray(data.queue)) state.queue = data.queue;
  if (data.credentials) state.credentials = data.credentials;
  if (Array.isArray(data.accounts)) {
    state.accounts = data.accounts.filter(
      (a) => a && typeof a.id === 'string' && typeof a.encrypted === 'string',
    );
  }
  if (data.defaultAccount && typeof data.defaultAccount === 'object') {
    state.defaultAccount = data.defaultAccount;
  }
  if (Array.isArray(data.pendingOAuth)) state.pendingOAuth = data.pendingOAuth;
  if (data.accountCooldowns && typeof data.accountCooldowns === 'object') {
    state.accountCooldowns = data.accountCooldowns;
  }
  if (data.lastLivePostByAccount && typeof data.lastLivePostByAccount === 'object') {
    state.lastLivePostByAccount = data.lastLivePostByAccount;
  }
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
  const usage = data.geminiUsage;
  if (usage && typeof usage.day === 'string' && Number.isFinite(Number(usage.calls))) {
    state.geminiUsage = { day: usage.day, calls: Number(usage.calls) };
  }
  return state;
};
