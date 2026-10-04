/**
 * Storage manager for X ChromaBot
 * Manages multiple tweet contexts, multi-schedule configurations, upcoming queue,
 * post logs, and state persistence.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { ColorData, DEFAULT_TWEET_TEMPLATE, generateColor } from './colorEngine.js';
import { TwitterCredentials } from './twitterClient.js';
import type {
  TweetContextSchedule,
  TweetContext,
  BotSettings,
  PostLog,
  QueueSlot,
  CooldownState,
  RateLimitHeaders,
  RateLimitTelemetry,
} from '../shared/types.js';
import { extractTweetId } from '../shared/tweetId.js';
import { substituteTemplate } from '../shared/template/substitute.js';
import { stripAgentTags } from '../shared/template/agentTags.js';

export type {
  TweetContextSchedule,
  TweetContext,
  BotSettings,
  PostLog,
  QueueSlot,
  CooldownState,
  RateLimitHeaders,
  RateLimitTelemetry,
} from '../shared/types.js';

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(process.cwd(), 'data');
const STORE_FILE = path.join(DATA_DIR, 'bot-store.json');

const DEFAULT_SETTINGS: BotSettings = {
  targetTweetId: process.env.TARGET_TWEET_ID || '2091597504928428416',
  scheduleTimes: (process.env.SCHEDULE_TIMES || '06:00,18:00').split(',').map((s) => s.trim()),
  timezone: process.env.SCHEDULE_TIMEZONE || 'America/Denver',
  schedulerEnabled: true,
  dryRun: false,
  template: DEFAULT_TWEET_TEMPLATE,
  themePreference: 'dynamic',
  intervalMode: 'interval',
  intervalMinutes: 15,
  humanizeJitterEnabled: true,
  jitterPercentage: 25,
  activeContextId: 'ctx_primary',
};

class StorageService {
  private settings: BotSettings;
  private contexts: TweetContext[] = [];
  private activeContextId: string = 'ctx_primary';
  private logs: PostLog[] = [];
  private queue: QueueSlot[] = [];
  private lastPostedSlot: string = '';
  private lastPostedTimestamp: number = 0;
  private currentJitterMs: number = 0;
  private userCredentials: TwitterCredentials = {};
  private cooldownUntilMs: number = 0;
  private cooldownReason: string = '';
  private lastThrottledAt: string = '';
  private lastGlobalLivePostTimestamp: number = 0;
  private lastCapturedRateLimitHeaders?: RateLimitHeaders;
  private lastRateLimitCaptureTimestamp?: number;

  constructor() {
    this.settings = { ...DEFAULT_SETTINGS };
    this.ensureDataDir();
    this.load();
    this.ensureDefaultContext();
    this.ensureWebhookSecret();
    this.syncQueue();
  }

  // --- Webhook secret (never part of getSettings) ---
  private ensureWebhookSecret() {
    if (process.env.WEBHOOK_SECRET || this.settings.webhookSecret) return;
    this.settings.webhookSecret = crypto.randomBytes(32).toString('hex');
    this.save();
    console.log(
      '[Storage] Generated a new webhook secret (stored in the data file; fetch it via GET /api/webhook/url).',
    );
  }

  public getWebhookSecret(): string {
    return process.env.WEBHOOK_SECRET || this.settings.webhookSecret || '';
  }

  public rotateWebhookSecret(): string {
    this.settings.webhookSecret = crypto.randomBytes(32).toString('hex');
    this.save();
    console.log('[Storage] Webhook secret rotated.');
    return this.getWebhookSecret();
  }

  private ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
      try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      } catch (e) {
        // ignore
      }
    }
  }

  private ensureDefaultContext() {
    if (this.contexts.length === 0) {
      const primary: TweetContext = {
        id: 'ctx_primary',
        name: 'Primary Eternal Colors',
        description: 'Main automated color palette reply thread on X',
        targetTweetId: this.settings.targetTweetId || '2091597504928428416',
        replyTargetMode: 'original_post',
        lastPostedTweetId: undefined,
        enabled: this.settings.schedulerEnabled ?? true,
        dryRun: this.settings.dryRun ?? false,
        schedule: {
          mode: this.settings.intervalMode || 'interval',
          intervalMinutes: this.settings.intervalMinutes || 1,
          scheduleTimes: this.settings.scheduleTimes || ['06:00', '18:00'],
          timezone: this.settings.timezone || 'America/Denver',
          humanizeJitterEnabled: this.settings.humanizeJitterEnabled ?? true,
          jitterPercentage: this.settings.jitterPercentage ?? 25,
        },
        template: this.settings.template || DEFAULT_TWEET_TEMPLATE,
        themePreference: this.settings.themePreference || 'dynamic',
        lastPostedTimestamp: this.lastPostedTimestamp || Date.now(),
        currentJitterMs: this.currentJitterMs || 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        stats: {
          totalPosts: this.logs.length,
          successfulPosts: this.logs.filter((l) => l.status === 'success').length,
          simulatedPosts: this.logs.filter((l) => l.status === 'simulated').length,
          failedPosts: this.logs.filter((l) => l.status === 'error').length,
        },
      };
      this.contexts.push(primary);
      this.activeContextId = primary.id;
      this.save();
    } else {
      if (!this.contexts.some((c) => c.id === this.activeContextId)) {
        this.activeContextId = this.contexts[0].id;
      }
      // Sanitize contexts to ensure no cross-campaign or quote-tweet chain pollution
      let modified = false;
      for (const ctx of this.contexts) {
        if (this.sanitizeContextChain(ctx)) {
          modified = true;
        }
      }
      if (modified) {
        this.save();
      }
    }
  }

  private sanitizeContextChain(ctx: TweetContext): boolean {
    let modified = false;
    if (ctx.autoFallbackToQuote) {
      ctx.autoFallbackToQuote = false;
      modified = true;
    }

    const quoteTweetIds = new Set(
      this.logs
        .filter(
          (l) =>
            l.engagementMode === 'quote' || l.engagementMode === 'standalone' || !!l.quoteTweetId,
        )
        .map((l) => l.tweetId)
        .filter(Boolean),
    );

    if (ctx.lastPostedTweetId) {
      const matchingLog = this.logs.find((l) => l.tweetId === ctx.lastPostedTweetId);
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
        const validReplyLogs = this.logs.filter(
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
        const latestValid = validReplyLogs[validReplyLogs.length - 1];
        ctx.lastPostedTweetId = latestValid?.tweetId || undefined;
        modified = true;
      }
    }

    return modified;
  }

  private load() {
    try {
      if (fs.existsSync(STORE_FILE)) {
        const raw = fs.readFileSync(STORE_FILE, 'utf-8');
        const data = JSON.parse(raw);
        if (data.settings) {
          this.settings = { ...DEFAULT_SETTINGS, ...data.settings };
        }
        if (Array.isArray(data.contexts) && data.contexts.length > 0) {
          this.contexts = data.contexts;
        }
        if (data.activeContextId) {
          this.activeContextId = data.activeContextId;
        }
        if (Array.isArray(data.logs)) {
          this.logs = data.logs;
        }
        if (Array.isArray(data.queue)) {
          this.queue = data.queue;
        }
        if (data.lastPostedSlot) {
          this.lastPostedSlot = data.lastPostedSlot;
        }
        if (data.lastPostedTimestamp) {
          this.lastPostedTimestamp = Number(data.lastPostedTimestamp);
        }
        if (data.currentJitterMs !== undefined) {
          this.currentJitterMs = Number(data.currentJitterMs);
        }
        if (data.credentials) {
          this.userCredentials = data.credentials;
        }
        if (data.cooldownUntilMs) {
          this.cooldownUntilMs = Number(data.cooldownUntilMs);
        }
        if (data.cooldownReason) {
          this.cooldownReason = data.cooldownReason;
        }
        if (data.lastThrottledAt) {
          this.lastThrottledAt = data.lastThrottledAt;
        }
        if (data.lastGlobalLivePostTimestamp) {
          this.lastGlobalLivePostTimestamp = Number(data.lastGlobalLivePostTimestamp);
        }
        if (data.lastCapturedRateLimitHeaders) {
          this.lastCapturedRateLimitHeaders = data.lastCapturedRateLimitHeaders;
        }
        if (data.lastRateLimitCaptureTimestamp) {
          this.lastRateLimitCaptureTimestamp = Number(data.lastRateLimitCaptureTimestamp);
        }
      }
    } catch (err) {
      console.warn('Could not read bot store file, using defaults:', err);
    }
  }

  public save() {
    try {
      this.ensureDataDir();
      const payload = {
        settings: this.settings,
        contexts: this.contexts,
        activeContextId: this.activeContextId,
        logs: this.logs.slice(-150),
        queue: this.queue,
        lastPostedSlot: this.lastPostedSlot,
        lastPostedTimestamp: this.lastPostedTimestamp,
        currentJitterMs: this.currentJitterMs,
        credentials: this.userCredentials,
        cooldownUntilMs: this.cooldownUntilMs,
        cooldownReason: this.cooldownReason,
        lastThrottledAt: this.lastThrottledAt,
        lastGlobalLivePostTimestamp: this.lastGlobalLivePostTimestamp,
        lastCapturedRateLimitHeaders: this.lastCapturedRateLimitHeaders,
        lastRateLimitCaptureTimestamp: this.lastRateLimitCaptureTimestamp,
      };
      fs.writeFileSync(STORE_FILE, JSON.stringify(payload, null, 2), 'utf-8');
    } catch (err) {
      console.error('Error saving bot store:', err);
    }
  }

  // --- Rate Limit & Anti-Spam Cooldown Methods ---

  public getCooldownState(): CooldownState {
    const now = Date.now();
    const isThrottled = this.cooldownUntilMs > now;
    return {
      isThrottled,
      throttledUntil: this.cooldownUntilMs,
      secondsRemaining: isThrottled ? Math.ceil((this.cooldownUntilMs - now) / 1000) : 0,
      reason: isThrottled ? this.cooldownReason : undefined,
      lastThrottledAt: this.lastThrottledAt || undefined,
    };
  }

  public setGlobalCooldown(durationMinutes: number, reason: string) {
    this.cooldownUntilMs = Date.now() + durationMinutes * 60 * 1000;
    this.cooldownReason = reason;
    this.lastThrottledAt = new Date().toISOString();
    console.log(`[Storage] Set global X API cooldown for ${durationMinutes} minutes: ${reason}`);
    this.save();
  }

  public clearGlobalCooldown() {
    this.cooldownUntilMs = 0;
    this.cooldownReason = '';
    console.log(`[Storage] Cleared global X API cooldown.`);
    this.save();
  }

  public recordLivePostTimestamp() {
    this.lastGlobalLivePostTimestamp = Date.now();
  }

  public getTimeSinceLastLivePostMs(): number {
    if (!this.lastGlobalLivePostTimestamp) return Infinity;
    return Date.now() - this.lastGlobalLivePostTimestamp;
  }

  // --- Rate Limit Telemetry & Quota Tracking ---

  public updateRateLimitTelemetry(headers?: RateLimitHeaders) {
    if (headers && (headers.limit !== undefined || headers.remaining !== undefined)) {
      this.lastCapturedRateLimitHeaders = headers;
      this.lastRateLimitCaptureTimestamp = Date.now();
      this.save();
    }
  }

  public getRateLimitTelemetry(): RateLimitTelemetry {
    const now = Date.now();
    const cooldown = this.getCooldownState();

    // Calculate 24-hour live post volume
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    const postsLast24Hours = this.logs.filter(
      (l) =>
        l.status === 'success' &&
        !l.tweetId?.startsWith('sim_') &&
        new Date(l.timestamp).getTime() >= oneDayAgo,
    ).length;

    const headers = this.lastCapturedRateLimitHeaders;
    const limit = headers?.limit ?? 50;
    const remaining = headers?.remaining ?? (cooldown.isThrottled ? 0 : 50);
    const resetEpochSeconds = headers?.reset ?? Math.floor((now + 15 * 60 * 1000) / 1000);
    const secondsUntilReset = Math.max(0, resetEpochSeconds - Math.floor(now / 1000));
    const resetDateIso = new Date(resetEpochSeconds * 1000).toISOString();

    // Identify account tier based on response headers
    let tierDetected:
      | 'Free (Legacy)'
      | 'Basic ($200/mo)'
      | 'Pay-Per-Use ($0.015/tweet)'
      | 'Pro ($5k/mo)'
      | 'Enterprise' = 'Pay-Per-Use ($0.015/tweet)';
    let estimatedDailyCap = 10000;

    if (limit <= 17 || headers?.appDailyLimit === 17) {
      tierDetected = 'Free (Legacy)';
      estimatedDailyCap = 17;
    } else if (headers?.appDailyLimit === 100 || headers?.userDailyLimit === 100) {
      tierDetected = 'Basic ($200/mo)';
      estimatedDailyCap = 100;
    } else if (limit >= 100) {
      tierDetected = 'Pro ($5k/mo)';
      estimatedDailyCap = 10000;
    }

    // Determine status
    let status: 'optimal' | 'warning' | 'throttled' = 'optimal';
    if (
      cooldown.isThrottled ||
      remaining === 0 ||
      (estimatedDailyCap <= 100 && postsLast24Hours >= estimatedDailyCap)
    ) {
      status = 'throttled';
    } else if (
      remaining < 5 ||
      (estimatedDailyCap <= 100 && postsLast24Hours >= estimatedDailyCap * 0.8)
    ) {
      status = 'warning';
    }

    return {
      limit,
      remaining,
      resetEpochSeconds,
      resetDateIso,
      secondsUntilReset,
      status,
      postsLast24Hours,
      estimatedDailyCap,
      lastUpdatedIso: this.lastRateLimitCaptureTimestamp
        ? new Date(this.lastRateLimitCaptureTimestamp).toISOString()
        : new Date().toISOString(),
      tierDetected,
      headersCaptured: !!this.lastCapturedRateLimitHeaders,
      activeCooldown: cooldown.isThrottled ? cooldown : undefined,
    };
  }

  // --- Context Management Methods ---

  public getContexts(): TweetContext[] {
    return this.contexts;
  }

  public getContext(id: string): TweetContext | undefined {
    return this.contexts.find((c) => c.id === id);
  }

  public getActiveContext(): TweetContext {
    const found = this.contexts.find((c) => c.id === this.activeContextId);
    if (found) return found;
    return this.contexts[0];
  }

  public setActiveContextId(id: string): TweetContext {
    const found = this.contexts.find((c) => c.id === id);
    if (found) {
      this.activeContextId = id;
      this.settings.activeContextId = id;
      // Sync global mirror settings
      this.syncActiveContextToSettings(found);
      this.save();
      return found;
    }
    return this.getActiveContext();
  }

  public createContext(data: Partial<TweetContext>): TweetContext {
    const id = data.id || `ctx_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const targetTweetId = this.cleanTweetId(
      data.targetTweetId || this.settings.targetTweetId || '2091597504928428416',
    );

    const newContext: TweetContext = {
      id,
      name: data.name?.trim() || `Context #${this.contexts.length + 1}`,
      description: data.description?.trim() || '',
      targetTweetId,
      replyTargetMode: data.replyTargetMode || 'original_post',
      engagementMode: data.engagementMode || 'reply',
      autoFallbackToQuote: false,
      lastPostedTweetId: data.lastPostedTweetId,
      enabled: data.enabled ?? true,
      dryRun: data.dryRun ?? false,
      schedule: {
        mode: data.schedule?.mode || 'interval',
        intervalMinutes: data.schedule?.intervalMinutes || 60,
        scheduleTimes: data.schedule?.scheduleTimes || ['06:00', '18:00'],
        timezone: data.schedule?.timezone || this.settings.timezone || 'America/Denver',
        humanizeJitterEnabled: data.schedule?.humanizeJitterEnabled ?? true,
        jitterPercentage: data.schedule?.jitterPercentage ?? 25,
      },
      template: data.template?.trim() || DEFAULT_TWEET_TEMPLATE,
      themePreference: data.themePreference || 'dynamic',
      lastPostedTimestamp: data.lastPostedTimestamp || 0,
      currentJitterMs: data.currentJitterMs || 0,
      createdAt: data.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      stats: data.stats || {
        totalPosts: 0,
        successfulPosts: 0,
        simulatedPosts: 0,
        failedPosts: 0,
      },
    };

    this.sanitizeContextChain(newContext);

    // Calculate initial jitter if interval
    this.generateRandomJitterForContext(newContext);

    this.contexts.push(newContext);
    this.clearAndRegenerateQueue(newContext.id);
    this.save();
    return newContext;
  }

  public updateContext(id: string, updates: Partial<TweetContext>): TweetContext {
    const idx = this.contexts.findIndex((c) => c.id === id);
    if (idx === -1) {
      // Upsert if context from cloud sync does not exist locally yet
      return this.createContext({ ...updates, id });
    }

    const current = this.contexts[idx];
    const targetTweetId = updates.targetTweetId
      ? this.cleanTweetId(updates.targetTweetId)
      : current.targetTweetId;
    const targetChanged = targetTweetId !== current.targetTweetId;

    const mergedSchedule: TweetContextSchedule = {
      ...current.schedule,
      ...(updates.schedule || {}),
    };

    const scheduleChanged =
      (updates.schedule?.intervalMinutes !== undefined &&
        updates.schedule.intervalMinutes !== current.schedule.intervalMinutes) ||
      (updates.schedule?.mode !== undefined && updates.schedule.mode !== current.schedule.mode);

    const updated: TweetContext = {
      ...current,
      ...updates,
      id: current.id, // Never allow id to be overwritten
      targetTweetId,
      replyTargetMode:
        updates.replyTargetMode !== undefined
          ? updates.replyTargetMode
          : current.replyTargetMode || 'original_post',
      engagementMode:
        updates.engagementMode !== undefined
          ? updates.engagementMode
          : current.engagementMode || 'reply',
      autoFallbackToQuote: false,
      lastPostedTweetId: targetChanged
        ? updates.lastPostedTweetId || undefined
        : 'lastPostedTweetId' in updates
          ? updates.lastPostedTweetId || undefined
          : current.lastPostedTweetId,
      schedule: mergedSchedule,
      updatedAt: new Date().toISOString(),
    };

    this.sanitizeContextChain(updated);

    if (scheduleChanged) {
      this.generateRandomJitterForContext(updated);
    }

    this.contexts[idx] = updated;

    if (this.activeContextId === id) {
      this.syncActiveContextToSettings(updated);
    }

    // Any save/edit of a campaign clears its queue and regenerates based on the new settings
    this.clearAndRegenerateQueue(id);

    this.save();
    return updated;
  }

  public deleteContext(id: string): boolean {
    if (this.contexts.length <= 1) {
      throw new Error('Cannot delete the only tweet context. At least one context must remain.');
    }
    const idx = this.contexts.findIndex((c) => c.id === id);
    if (idx === -1) return false;

    this.contexts.splice(idx, 1);
    this.queue = this.queue.filter((q) => q.contextId !== id);
    if (this.activeContextId === id) {
      this.activeContextId = this.contexts[0].id;
      this.syncActiveContextToSettings(this.contexts[0]);
    }
    this.save();
    return true;
  }

  public duplicateContext(id: string): TweetContext {
    const source = this.getContext(id);
    if (!source) {
      throw new Error(`Context ${id} not found`);
    }

    return this.createContext({
      name: `${source.name} (Copy)`,
      description: source.description,
      targetTweetId: source.targetTweetId,
      replyTargetMode: source.replyTargetMode || 'original_post',
      engagementMode: source.engagementMode || 'reply',
      autoFallbackToQuote: false,
      lastPostedTweetId: undefined, // Fresh copy starts clean
      enabled: false, // Start paused
      dryRun: source.dryRun,
      schedule: { ...source.schedule },
      template: source.template,
      themePreference: source.themePreference,
    });
  }

  public toggleContext(id: string): TweetContext {
    const current = this.getContext(id);
    if (!current) {
      throw new Error(`Context ${id} not found`);
    }
    return this.updateContext(id, { enabled: !current.enabled });
  }

  public resetContextChain(id: string): TweetContext {
    const current = this.getContext(id);
    if (!current) {
      throw new Error(`Context ${id} not found`);
    }
    current.lastPostedTweetId = undefined;
    if (this.activeContextId === id) {
      this.settings.lastPostedTweetId = undefined;
    }
    this.clearAndRegenerateQueue(id);
    this.save();
    return current;
  }

  /**
   * Look up the most recent tweet ID posted by us for this context.
   * Strictly verifies that the tweet belongs to this context's reply chain and is not a quote/standalone post.
   */
  public getContextLastPostedTweetId(contextId: string): string | undefined {
    const context = this.getContext(contextId);
    if (!context || context.replyTargetMode !== 'last_comment') {
      return undefined;
    }
    const candidateId = context.lastPostedTweetId;
    if (!candidateId || !/^\d+$/.test(candidateId)) {
      return undefined;
    }

    const matchingLog = this.logs.find((l) => l.tweetId === candidateId);
    if (matchingLog) {
      if (
        matchingLog.engagementMode === 'quote' ||
        matchingLog.engagementMode === 'standalone' ||
        !!matchingLog.quoteTweetId ||
        (matchingLog.contextId && matchingLog.contextId !== contextId) ||
        (matchingLog.targetTweetId && matchingLog.targetTweetId !== context.targetTweetId)
      ) {
        return undefined;
      }
    }

    return candidateId;
  }

  /**
   * Determine the effective target tweet ID to reply to based on context's replyTargetMode.
   */
  public getEffectiveReplyTargetId(context: TweetContext): {
    targetTweetId: string;
    isCascadingToLastComment: boolean;
    isFirstInChain: boolean;
  } {
    if (context.replyTargetMode === 'last_comment') {
      const lastTweetId = this.getContextLastPostedTweetId(context.id);
      if (lastTweetId) {
        return {
          targetTweetId: lastTweetId,
          isCascadingToLastComment: true,
          isFirstInChain: false,
        };
      }
      // If no prior comment made yet, reply to root targetTweetId to initiate chain
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
  }

  public generateRandomJitterForContext(context: TweetContext): number {
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
  }

  public recordContextPostResult(
    contextId: string,
    status: 'success' | 'simulated' | 'error',
    postedTweetId?: string,
    engagementMode: 'reply' | 'quote' | 'standalone' = 'reply',
  ) {
    const context = this.getContext(contextId);
    if (!context) return;

    if (!context.stats) {
      context.stats = { totalPosts: 0, successfulPosts: 0, simulatedPosts: 0, failedPosts: 0 };
    }
    context.stats.totalPosts += 1;
    if (status === 'success') context.stats.successfulPosts += 1;
    if (status === 'simulated') context.stats.simulatedPosts += 1;
    if (status === 'error') {
      context.stats.failedPosts += 1;
      context.consecutiveErrors = (context.consecutiveErrors || 0) + 1;
      // Safety anti-hammer backoff: If posting hit an error (such as an X reply cooldown),
      // back off by at least 15 minutes so the developer account has time to clear the cooldown
      const intervalMs = (context.schedule.intervalMinutes || 15) * 60 * 1000;
      const minRetryDelayMs = 15 * 60 * 1000;
      if (intervalMs < minRetryDelayMs) {
        context.lastPostedTimestamp = Date.now() + (minRetryDelayMs - intervalMs);
      } else {
        context.lastPostedTimestamp = Date.now();
      }
    } else {
      context.consecutiveErrors = 0;
      context.lastPostedTimestamp = Date.now();
    }

    // Only update lastPostedTweetId if this was a genuine in-thread reply
    if (
      postedTweetId &&
      status === 'success' &&
      engagementMode === 'reply' &&
      /^\d+$/.test(postedTweetId)
    ) {
      context.lastPostedTweetId = postedTweetId;
      if (this.activeContextId === contextId) {
        this.settings.lastPostedTweetId = postedTweetId;
      }
    }
    this.generateRandomJitterForContext(context);
    this.save();
  }

  private syncActiveContextToSettings(ctx: TweetContext) {
    this.settings.targetTweetId = ctx.targetTweetId;
    this.settings.replyTargetMode = ctx.replyTargetMode || 'original_post';
    this.settings.engagementMode = ctx.engagementMode || 'reply';
    this.settings.autoFallbackToQuote = ctx.autoFallbackToQuote ?? true;
    this.settings.lastPostedTweetId = ctx.lastPostedTweetId;
    this.settings.schedulerEnabled = ctx.enabled;
    this.settings.dryRun = ctx.dryRun ?? false;
    this.settings.template = ctx.template;
    this.settings.themePreference = ctx.themePreference;
    this.settings.intervalMode = ctx.schedule.mode;
    this.settings.intervalMinutes = ctx.schedule.intervalMinutes;
    this.settings.scheduleTimes = ctx.schedule.scheduleTimes;
    this.settings.timezone = ctx.schedule.timezone;
    this.settings.humanizeJitterEnabled = ctx.schedule.humanizeJitterEnabled;
    this.settings.jitterPercentage = ctx.schedule.jitterPercentage;
    this.settings.activeContextId = ctx.id;
  }

  private cleanTweetId(input: string): string {
    return extractTweetId(input) ?? input.trim();
  }

  // --- Backwards Compatibility with global BotSettings ---

  public getSettings(): BotSettings {
    const active = this.getActiveContext();
    return {
      targetTweetId: active.targetTweetId,
      replyTargetMode: active.replyTargetMode || 'original_post',
      engagementMode: active.engagementMode || 'reply',
      autoFallbackToQuote: active.autoFallbackToQuote ?? true,
      lastPostedTweetId: active.lastPostedTweetId,
      scheduleTimes: active.schedule.scheduleTimes,
      timezone: active.schedule.timezone,
      schedulerEnabled: active.enabled,
      dryRun: active.dryRun ?? this.settings.dryRun,
      template: active.template,
      themePreference: active.themePreference,
      intervalMode: active.schedule.mode,
      intervalMinutes: active.schedule.intervalMinutes,
      humanizeJitterEnabled: active.schedule.humanizeJitterEnabled,
      jitterPercentage: active.schedule.jitterPercentage,
      activeContextId: active.id,
    };
  }

  public updateSettings(newSettings: Partial<BotSettings>): BotSettings {
    const active = this.getActiveContext();
    const scheduleUpdates: Partial<TweetContextSchedule> = {};

    if (newSettings.intervalMode) scheduleUpdates.mode = newSettings.intervalMode;
    if (newSettings.intervalMinutes) scheduleUpdates.intervalMinutes = newSettings.intervalMinutes;
    if (newSettings.scheduleTimes) scheduleUpdates.scheduleTimes = newSettings.scheduleTimes;
    if (newSettings.timezone) scheduleUpdates.timezone = newSettings.timezone;
    if (newSettings.humanizeJitterEnabled !== undefined)
      scheduleUpdates.humanizeJitterEnabled = newSettings.humanizeJitterEnabled;
    if (newSettings.jitterPercentage !== undefined)
      scheduleUpdates.jitterPercentage = newSettings.jitterPercentage;

    const contextUpdates: Partial<TweetContext> = {};
    if (newSettings.targetTweetId) contextUpdates.targetTweetId = newSettings.targetTweetId;
    if (newSettings.replyTargetMode) contextUpdates.replyTargetMode = newSettings.replyTargetMode;
    if (newSettings.engagementMode) contextUpdates.engagementMode = newSettings.engagementMode;
    if (newSettings.autoFallbackToQuote !== undefined)
      contextUpdates.autoFallbackToQuote = newSettings.autoFallbackToQuote;
    if (newSettings.lastPostedTweetId !== undefined)
      contextUpdates.lastPostedTweetId = newSettings.lastPostedTweetId;
    if (newSettings.schedulerEnabled !== undefined)
      contextUpdates.enabled = newSettings.schedulerEnabled;
    if (newSettings.dryRun !== undefined) contextUpdates.dryRun = newSettings.dryRun;
    if (newSettings.template) contextUpdates.template = newSettings.template;
    if (newSettings.themePreference) contextUpdates.themePreference = newSettings.themePreference;
    if (Object.keys(scheduleUpdates).length > 0)
      contextUpdates.schedule = { ...active.schedule, ...scheduleUpdates };

    this.updateContext(active.id, contextUpdates);

    return this.getSettings();
  }

  // --- Credentials ---

  public getEffectiveCredentials(): TwitterCredentials {
    return {
      apiKey: process.env.TWITTER_API_KEY || this.userCredentials.apiKey || '',
      apiSecret: process.env.TWITTER_API_SECRET || this.userCredentials.apiSecret || '',
      accessToken: process.env.TWITTER_ACCESS_TOKEN || this.userCredentials.accessToken || '',
      accessTokenSecret:
        process.env.TWITTER_ACCESS_TOKEN_SECRET || this.userCredentials.accessTokenSecret || '',
      oauth2ClientId:
        process.env.TWITTER_OAUTH2_CLIENT_ID || this.userCredentials.oauth2ClientId || '',
      oauth2ClientSecret:
        process.env.TWITTER_OAUTH2_CLIENT_SECRET || this.userCredentials.oauth2ClientSecret || '',
      oauth2AccessToken:
        process.env.TWITTER_OAUTH2_ACCESS_TOKEN || this.userCredentials.oauth2AccessToken || '',
      oauth2RefreshToken:
        process.env.TWITTER_OAUTH2_REFRESH_TOKEN || this.userCredentials.oauth2RefreshToken || '',
      bearerToken: process.env.TWITTER_BEARER_TOKEN || this.userCredentials.bearerToken || '',
    };
  }

  public getMaskedCredentialsStatus() {
    const creds = this.getEffectiveCredentials();
    const mask = (val?: string) => {
      if (!val) return null;
      if (val.length <= 6) return '••••••';
      return `${val.substring(0, 3)}••••${val.substring(val.length - 3)}`;
    };

    const hasOAuth1 = !!(
      creds.apiKey &&
      creds.apiSecret &&
      creds.accessToken &&
      creds.accessTokenSecret
    );
    const hasOAuth2 = !!(
      creds.oauth2AccessToken ||
      (creds.oauth2ClientId && creds.oauth2RefreshToken)
    );

    return {
      hasApiKey: !!creds.apiKey,
      apiKeyMasked: mask(creds.apiKey),
      hasApiSecret: !!creds.apiSecret,
      hasAccessToken: !!creds.accessToken,
      accessTokenMasked: mask(creds.accessToken),
      hasAccessTokenSecret: !!creds.accessTokenSecret,
      hasOAuth2ClientId: !!creds.oauth2ClientId,
      oauth2ClientIdMasked: mask(creds.oauth2ClientId),
      hasOAuth2ClientSecret: !!creds.oauth2ClientSecret,
      hasOAuth2AccessToken: !!creds.oauth2AccessToken,
      hasOAuth2RefreshToken: !!creds.oauth2RefreshToken,
      hasBearerToken: !!creds.bearerToken,
      authMethod: hasOAuth1
        ? 'OAuth 1.0a (Permanent)'
        : hasOAuth2
          ? 'OAuth 2.0 User Context'
          : 'None',
      isFullyConfigured: hasOAuth1 || hasOAuth2,
      source: process.env.TWITTER_API_KEY
        ? 'environment_variables'
        : this.userCredentials.apiKey
          ? 'server_config'
          : 'none',
    };
  }

  public updateCredentials(creds: Partial<TwitterCredentials>) {
    this.userCredentials = {
      ...this.userCredentials,
      ...creds,
    };
    this.save();
  }

  // --- Logs & Queue ---

  public getLogs(): PostLog[] {
    return [...this.logs].reverse();
  }

  public addLog(log: PostLog) {
    this.logs.push(log);
    this.save();
  }

  public clearLogs() {
    this.logs = [];
    this.save();
  }

  public clearContextHistory(contextId: string): { clearedCount: number; context?: TweetContext } {
    const beforeCount = this.logs.length;
    // Filter out logs matching contextId (and if primary context, logs with ctx_primary or no contextId)
    this.logs = this.logs.filter((l) => {
      if (contextId === 'ctx_primary') {
        return l.contextId && l.contextId !== 'ctx_primary';
      }
      return l.contextId !== contextId;
    });
    const clearedCount = beforeCount - this.logs.length;

    // Reset campaign stats and anchors
    const ctx = this.getContext(contextId);
    if (ctx) {
      ctx.stats = {
        totalPosts: 0,
        successfulPosts: 0,
        simulatedPosts: 0,
        failedPosts: 0,
      };
      ctx.lastPostedTimestamp = 0;
      ctx.lastPostedSlot = undefined;
      ctx.lastPostedTweetId = undefined; // Reset chain anchor to clean slate
      if (this.activeContextId === contextId) {
        this.settings.lastPostedTweetId = undefined;
      }
      this.clearAndRegenerateQueue(contextId);
    }
    this.save();
    return { clearedCount, context: ctx };
  }

  public getLastPostedSlot(): string {
    return this.lastPostedSlot;
  }

  public setLastPostedSlot(slot: string) {
    this.lastPostedSlot = slot;
    this.save();
  }

  public getLastPostedTimestamp(): number {
    return this.lastPostedTimestamp;
  }

  public setLastPostedTimestamp(ts: number) {
    this.lastPostedTimestamp = ts;
    this.save();
  }

  public getCurrentJitterMs(): number {
    return this.currentJitterMs;
  }

  public setCurrentJitterMs(ms: number) {
    this.currentJitterMs = Math.max(0, ms);
    this.save();
  }

  public generateRandomJitter(windowMs: number): number {
    if (this.settings.humanizeJitterEnabled === false) {
      this.currentJitterMs = 0;
      this.save();
      return 0;
    }
    const maxPercent = (this.settings.jitterPercentage ?? 25) / 100;
    const maxJitterMs = Math.floor(windowMs * maxPercent);
    const randomJitter = Math.floor(Math.random() * (maxJitterMs + 1));
    this.currentJitterMs = randomJitter;
    this.save();
    return randomJitter;
  }

  private formatSlotPreviewText(template: string, color: ColorData, slotLabel: string): string {
    const colorPick = color.colorPick || color.name;
    const weatherDesc = color.weatherDesc || 'warming crisp morning air';
    const weatherTweet = `${colorPick} ${weatherDesc} #eternal #colors`;

    const substituted = substituteTemplate(template || DEFAULT_TWEET_TEMPLATE, color, {
      slotLabel,
      fallbackWeatherDesc: 'warming crisp morning air',
    });
    const resolved = stripAgentTags(substituted, `${colorPick} ${color.hex}`);
    const finalPreview = resolved.trim();
    return finalPreview || weatherTweet;
  }

  private createQueueSlotForContext(
    ctx: TweetContext,
    slotIndex: number,
    baseTimeMs = Date.now(),
  ): QueueSlot {
    const tz =
      !ctx.schedule?.timezone || ctx.schedule.timezone === 'MST'
        ? 'America/Denver'
        : ctx.schedule.timezone;

    if (ctx.schedule?.mode === 'interval') {
      const intervalMins = Math.max(1, ctx.schedule.intervalMinutes || 15);
      const futureDate = new Date(baseTimeMs + (slotIndex + 1) * intervalMins * 60 * 1000);
      let dateStr = futureDate.toISOString().split('T')[0];
      let timeSlot = '06:00';
      let isMorning = true;

      try {
        const parts = new Intl.DateTimeFormat('en-CA', {
          timeZone: tz,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).formatToParts(futureDate);
        const y = parts.find((p) => p.type === 'year')?.value || '2026';
        const m = parts.find((p) => p.type === 'month')?.value || '01';
        const d = parts.find((p) => p.type === 'day')?.value || '01';
        const hr = parseInt(parts.find((p) => p.type === 'hour')?.value || '6', 10) % 24;
        const mn = parts.find((p) => p.type === 'minute')?.value || '00';
        dateStr = `${y}-${m}-${d}`;
        timeSlot = `${hr.toString().padStart(2, '0')}:${mn}`;
        isMorning = hr < 12;
      } catch {
        const hr = futureDate.getUTCHours();
        const mn = futureDate.getUTCMinutes().toString().padStart(2, '0');
        timeSlot = `${hr.toString().padStart(2, '0')}:${mn}`;
        isMorning = hr < 12;
      }

      const slotType: 'morning' | 'evening' = isMorning ? 'morning' : 'evening';
      const color = generateColor(slotType);
      const previewText = this.formatSlotPreviewText(ctx.template, color, timeSlot);

      return {
        slotId: `slot_${ctx.id}_${Date.now()}_${slotIndex}_${Math.random().toString(36).substring(2, 6)}`,
        dateStr,
        timeSlot,
        slotType,
        color,
        contextId: ctx.id,
        contextName: ctx.name,
        previewText,
        targetTweetId: ctx.targetTweetId,
        replyTargetMode: ctx.replyTargetMode || 'original_post',
      };
    }

    // Fixed times mode
    const times = ctx.schedule?.scheduleTimes?.length
      ? ctx.schedule.scheduleTimes
      : ['06:00', '18:00'];
    const dayOffset = Math.floor(slotIndex / times.length);
    const timeIdx = slotIndex % times.length;
    const timeSlot = times[timeIdx] || '06:00';
    const hourNum = parseInt(timeSlot.split(':')[0] || '6', 10);
    const slotType: 'morning' | 'evening' = hourNum < 12 ? 'morning' : 'evening';
    const futureDate = new Date(baseTimeMs + dayOffset * 86400000);
    const dateStr = futureDate.toISOString().split('T')[0];
    const color = generateColor(slotType);
    const previewText = this.formatSlotPreviewText(ctx.template, color, timeSlot);

    return {
      slotId: `slot_${ctx.id}_${dateStr}_${timeSlot}_${slotIndex}_${Math.random().toString(36).substring(2, 6)}`,
      dateStr,
      timeSlot,
      slotType,
      color,
      contextId: ctx.id,
      contextName: ctx.name,
      previewText,
      targetTweetId: ctx.targetTweetId,
      replyTargetMode: ctx.replyTargetMode || 'original_post',
    };
  }

  /**
   * Clears existing queue slots for the specified campaign (or all campaigns if omitted)
   * and regenerates 14 fresh slots based on the campaign's current template & schedule settings.
   */
  public clearAndRegenerateQueue(contextId?: string): QueueSlot[] {
    const requiredCount = 14;
    const nowMs = Date.now();

    if (contextId) {
      const ctx = this.getContext(contextId);
      if (!ctx) return this.getQueue();
      // Remove all slots belonging to this context (and any legacy untagged slots)
      this.queue = this.queue.filter((q) => q.contextId && q.contextId !== contextId);
      for (let i = 0; i < requiredCount; i++) {
        this.queue.push(this.createQueueSlotForContext(ctx, i, nowMs));
      }
      this.save();
      return this.queue.filter((q) => q.contextId === contextId);
    }

    // Regenerate for all contexts
    this.queue = [];
    for (const ctx of this.contexts) {
      for (let i = 0; i < requiredCount; i++) {
        this.queue.push(this.createQueueSlotForContext(ctx, i, nowMs));
      }
    }
    this.save();
    return this.getQueue();
  }

  public getQueue(contextId?: string): QueueSlot[] {
    const targetId = contextId || this.activeContextId;
    this.syncQueue(targetId);
    return this.queue.filter((q) => q.contextId === targetId);
  }

  public rerollQueueSlot(slotId: string): QueueSlot | null {
    const idx = this.queue.findIndex((q) => q.slotId === slotId);
    if (idx === -1) return null;
    const current = this.queue[idx];
    const ctx =
      (current.contextId ? this.getContext(current.contextId) : undefined) ||
      this.getActiveContext();
    const newColor = generateColor(current.slotType);
    const previewText = this.formatSlotPreviewText(ctx.template, newColor, current.timeSlot);
    this.queue[idx] = {
      ...current,
      color: newColor,
      previewText,
      contextId: ctx.id,
      contextName: ctx.name,
      targetTweetId: ctx.targetTweetId,
      replyTargetMode: ctx.replyTargetMode || 'original_post',
    };
    this.save();
    return this.queue[idx];
  }

  public popNextQueueSlot(slotType: 'morning' | 'evening', contextId?: string): ColorData {
    const targetId = contextId || this.activeContextId;
    this.syncQueue(targetId);
    const nextIdx = this.queue.findIndex((q) => q.contextId === targetId);
    if (nextIdx !== -1) {
      const item = this.queue.splice(nextIdx, 1)[0];
      this.syncQueue(targetId);
      this.save();
      return item.color;
    }
    return generateColor(slotType);
  }

  private syncQueue(contextId?: string) {
    const requiredCount = 14;
    const nowMs = Date.now();

    // Remove legacy untagged slots that lack contextId or previewText
    const hasLegacySlots = this.queue.some((q) => !q.contextId || !q.previewText);
    if (hasLegacySlots) {
      this.queue = this.queue.filter((q) => !!q.contextId && !!q.previewText);
    }

    const contextsToSync = contextId
      ? [this.getContext(contextId) || this.getActiveContext()].filter(Boolean)
      : this.contexts;

    let modified = hasLegacySlots;
    for (const ctx of contextsToSync) {
      if (!ctx) continue;
      const existing = this.queue.filter((q) => q.contextId === ctx.id);
      let idx = existing.length;
      while (idx < requiredCount) {
        this.queue.push(this.createQueueSlotForContext(ctx, idx, nowMs));
        idx++;
        modified = true;
      }
    }

    if (modified) {
      this.save();
    }
  }
}

export const storage = new StorageService();
