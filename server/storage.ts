/**
 * Storage manager for X ChromaBot
 * Manages multiple tweet contexts, multi-schedule configurations, upcoming queue,
 * post logs, and state persistence.
 */

import fs from 'fs';
import path from 'path';
import { ColorData, DEFAULT_TWEET_TEMPLATE, generateColor } from './colorEngine.js';
import { TwitterCredentials } from './twitterClient.js';

export interface TweetContextSchedule {
  mode: 'interval' | 'fixed_times';
  intervalMinutes: number; // e.g. 1, 15, 30, 60, 180, 360, 720
  scheduleTimes: string[]; // e.g. ["06:00", "18:00"]
  timezone: string; // e.g. "America/Los_Angeles"
  humanizeJitterEnabled: boolean; // Random humanized delay
  jitterPercentage: number; // Default 25 (0 to 25% of repeat window)
}

export interface TweetContext {
  id: string;
  name: string;
  description?: string;
  targetTweetId: string;
  enabled: boolean;
  dryRun?: boolean;
  schedule: TweetContextSchedule;
  template: string;
  themePreference: 'dynamic' | 'vibrant' | 'minimal' | 'poetic';
  lastPostedTimestamp?: number;
  currentJitterMs?: number;
  lastPostedSlot?: string;
  stats?: {
    totalPosts: number;
    successfulPosts: number;
    simulatedPosts: number;
    failedPosts: number;
  };
  createdAt?: string;
  updatedAt?: string;
}

export interface BotSettings {
  targetTweetId: string;
  scheduleTimes: string[];
  timezone: string;
  schedulerEnabled: boolean;
  dryRun: boolean;
  template: string;
  themePreference: 'dynamic' | 'vibrant' | 'minimal' | 'poetic';
  intervalMode?: 'fixed_times' | 'interval';
  intervalMinutes?: number;
  webhookSecret?: string;
  humanizeJitterEnabled?: boolean;
  jitterPercentage?: number;
  activeContextId?: string;
}

export interface PostLog {
  id: string;
  timestamp: string;
  slotType: 'morning' | 'evening' | 'manual';
  scheduledTime?: string;
  targetTweetId: string;
  color: ColorData;
  tweetText: string;
  tweetId?: string;
  tweetUrl?: string;
  status: 'success' | 'simulated' | 'error';
  errorMessage?: string;
  contextId?: string;
  contextName?: string;
}

export interface QueueSlot {
  slotId: string;
  dateStr: string;
  timeSlot: '06:00' | '18:00' | string;
  slotType: 'morning' | 'evening';
  color: ColorData;
  contextId?: string;
  contextName?: string;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const STORE_FILE = path.join(DATA_DIR, 'bot-store.json');

const DEFAULT_SETTINGS: BotSettings = {
  targetTweetId: process.env.TARGET_TWEET_ID || '2091597504928428416',
  scheduleTimes: (process.env.SCHEDULE_TIMES || '06:00,18:00').split(',').map(s => s.trim()),
  timezone: process.env.SCHEDULE_TIMEZONE || 'America/Los_Angeles',
  schedulerEnabled: true,
  dryRun: false,
  template: DEFAULT_TWEET_TEMPLATE,
  themePreference: 'dynamic',
  intervalMode: 'interval',
  intervalMinutes: 1,
  webhookSecret: 'chroma_auto_secret',
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

  constructor() {
    this.settings = { ...DEFAULT_SETTINGS };
    this.ensureDataDir();
    this.load();
    this.ensureDefaultContext();
    this.syncQueue();
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
        enabled: this.settings.schedulerEnabled ?? true,
        dryRun: this.settings.dryRun ?? false,
        schedule: {
          mode: this.settings.intervalMode || 'interval',
          intervalMinutes: this.settings.intervalMinutes || 1,
          scheduleTimes: this.settings.scheduleTimes || ['06:00', '18:00'],
          timezone: this.settings.timezone || 'America/Los_Angeles',
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
          successfulPosts: this.logs.filter(l => l.status === 'success').length,
          simulatedPosts: this.logs.filter(l => l.status === 'simulated').length,
          failedPosts: this.logs.filter(l => l.status === 'error').length,
        },
      };
      this.contexts.push(primary);
      this.activeContextId = primary.id;
      this.save();
    } else {
      if (!this.contexts.some(c => c.id === this.activeContextId)) {
        this.activeContextId = this.contexts[0].id;
      }
    }
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
      };
      fs.writeFileSync(STORE_FILE, JSON.stringify(payload, null, 2), 'utf-8');
    } catch (err) {
      console.error('Error saving bot store:', err);
    }
  }

  // --- Context Management Methods ---

  public getContexts(): TweetContext[] {
    return this.contexts;
  }

  public getContext(id: string): TweetContext | undefined {
    return this.contexts.find(c => c.id === id);
  }

  public getActiveContext(): TweetContext {
    const found = this.contexts.find(c => c.id === this.activeContextId);
    if (found) return found;
    return this.contexts[0];
  }

  public setActiveContextId(id: string): TweetContext {
    const found = this.contexts.find(c => c.id === id);
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
    const id = `ctx_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const targetTweetId = this.cleanTweetId(data.targetTweetId || this.settings.targetTweetId || '2091597504928428416');
    
    const newContext: TweetContext = {
      id,
      name: data.name?.trim() || `Context #${this.contexts.length + 1}`,
      description: data.description?.trim() || '',
      targetTweetId,
      enabled: data.enabled ?? true,
      dryRun: data.dryRun ?? false,
      schedule: {
        mode: data.schedule?.mode || 'interval',
        intervalMinutes: data.schedule?.intervalMinutes || 60,
        scheduleTimes: data.schedule?.scheduleTimes || ['06:00', '18:00'],
        timezone: data.schedule?.timezone || this.settings.timezone || 'America/Los_Angeles',
        humanizeJitterEnabled: data.schedule?.humanizeJitterEnabled ?? true,
        jitterPercentage: data.schedule?.jitterPercentage ?? 25,
      },
      template: data.template?.trim() || DEFAULT_TWEET_TEMPLATE,
      themePreference: data.themePreference || 'dynamic',
      lastPostedTimestamp: 0,
      currentJitterMs: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      stats: {
        totalPosts: 0,
        successfulPosts: 0,
        simulatedPosts: 0,
        failedPosts: 0,
      },
    };

    // Calculate initial jitter if interval
    this.generateRandomJitterForContext(newContext);

    this.contexts.push(newContext);
    this.save();
    return newContext;
  }

  public updateContext(id: string, updates: Partial<TweetContext>): TweetContext {
    const idx = this.contexts.findIndex(c => c.id === id);
    if (idx === -1) {
      throw new Error(`Context ${id} not found`);
    }

    const current = this.contexts[idx];
    const targetTweetId = updates.targetTweetId
      ? this.cleanTweetId(updates.targetTweetId)
      : current.targetTweetId;

    const mergedSchedule: TweetContextSchedule = {
      ...current.schedule,
      ...(updates.schedule || {}),
    };

    const updated: TweetContext = {
      ...current,
      ...updates,
      targetTweetId,
      schedule: mergedSchedule,
      updatedAt: new Date().toISOString(),
    };

    this.contexts[idx] = updated;

    if (this.activeContextId === id) {
      this.syncActiveContextToSettings(updated);
    }

    this.save();
    return updated;
  }

  public deleteContext(id: string): boolean {
    if (this.contexts.length <= 1) {
      throw new Error('Cannot delete the only tweet context. At least one context must remain.');
    }
    const idx = this.contexts.findIndex(c => c.id === id);
    if (idx === -1) return false;

    this.contexts.splice(idx, 1);
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

  public generateRandomJitterForContext(context: TweetContext): number {
    if (!context.schedule.humanizeJitterEnabled) {
      context.currentJitterMs = 0;
      return 0;
    }
    const intervalMinutes = context.schedule.intervalMinutes || 60;
    const windowMs = context.schedule.mode === 'interval'
      ? intervalMinutes * 60 * 1000
      : (context.schedule.scheduleTimes.length > 1 ? (24 / context.schedule.scheduleTimes.length) * 3600 * 1000 : 12 * 3600 * 1000);

    const maxPercent = (context.schedule.jitterPercentage ?? 25) / 100;
    const maxJitterMs = Math.floor(windowMs * maxPercent);
    const randomJitter = Math.floor(Math.random() * (maxJitterMs + 1));
    context.currentJitterMs = randomJitter;
    return randomJitter;
  }

  public recordContextPostResult(contextId: string, status: 'success' | 'simulated' | 'error') {
    const context = this.getContext(contextId);
    if (!context) return;

    if (!context.stats) {
      context.stats = { totalPosts: 0, successfulPosts: 0, simulatedPosts: 0, failedPosts: 0 };
    }
    context.stats.totalPosts += 1;
    if (status === 'success') context.stats.successfulPosts += 1;
    if (status === 'simulated') context.stats.simulatedPosts += 1;
    if (status === 'error') context.stats.failedPosts += 1;

    context.lastPostedTimestamp = Date.now();
    this.generateRandomJitterForContext(context);
    this.save();
  }

  private syncActiveContextToSettings(ctx: TweetContext) {
    this.settings.targetTweetId = ctx.targetTweetId;
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
    const matched = input.match(/\b\d{10,25}\b/);
    if (matched) return matched[0];
    return input.trim();
  }

  // --- Backwards Compatibility with global BotSettings ---

  public getSettings(): BotSettings {
    const active = this.getActiveContext();
    return {
      targetTweetId: active.targetTweetId,
      scheduleTimes: active.schedule.scheduleTimes,
      timezone: active.schedule.timezone,
      schedulerEnabled: active.enabled,
      dryRun: active.dryRun ?? this.settings.dryRun,
      template: active.template,
      themePreference: active.themePreference,
      intervalMode: active.schedule.mode,
      intervalMinutes: active.schedule.intervalMinutes,
      webhookSecret: this.settings.webhookSecret || 'chroma_auto_secret',
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
    if (newSettings.humanizeJitterEnabled !== undefined) scheduleUpdates.humanizeJitterEnabled = newSettings.humanizeJitterEnabled;
    if (newSettings.jitterPercentage !== undefined) scheduleUpdates.jitterPercentage = newSettings.jitterPercentage;

    const contextUpdates: Partial<TweetContext> = {};
    if (newSettings.targetTweetId) contextUpdates.targetTweetId = newSettings.targetTweetId;
    if (newSettings.schedulerEnabled !== undefined) contextUpdates.enabled = newSettings.schedulerEnabled;
    if (newSettings.dryRun !== undefined) contextUpdates.dryRun = newSettings.dryRun;
    if (newSettings.template) contextUpdates.template = newSettings.template;
    if (newSettings.themePreference) contextUpdates.themePreference = newSettings.themePreference;
    if (Object.keys(scheduleUpdates).length > 0) contextUpdates.schedule = { ...active.schedule, ...scheduleUpdates };

    this.updateContext(active.id, contextUpdates);

    if (newSettings.webhookSecret) {
      this.settings.webhookSecret = newSettings.webhookSecret;
      this.save();
    }

    return this.getSettings();
  }

  // --- Credentials ---

  public getEffectiveCredentials(): TwitterCredentials {
    return {
      apiKey: process.env.TWITTER_API_KEY || this.userCredentials.apiKey || '',
      apiSecret: process.env.TWITTER_API_SECRET || this.userCredentials.apiSecret || '',
      accessToken: process.env.TWITTER_ACCESS_TOKEN || this.userCredentials.accessToken || '',
      accessTokenSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET || this.userCredentials.accessTokenSecret || '',
      oauth2ClientId: process.env.TWITTER_OAUTH2_CLIENT_ID || this.userCredentials.oauth2ClientId || '',
      oauth2ClientSecret: process.env.TWITTER_OAUTH2_CLIENT_SECRET || this.userCredentials.oauth2ClientSecret || '',
      oauth2AccessToken: process.env.TWITTER_OAUTH2_ACCESS_TOKEN || this.userCredentials.oauth2AccessToken || '',
      oauth2RefreshToken: process.env.TWITTER_OAUTH2_REFRESH_TOKEN || this.userCredentials.oauth2RefreshToken || '',
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

    const hasOAuth1 = !!(creds.apiKey && creds.apiSecret && creds.accessToken && creds.accessTokenSecret);
    const hasOAuth2 = !!(creds.oauth2AccessToken || (creds.oauth2ClientId && creds.oauth2RefreshToken));

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
      authMethod: hasOAuth1 ? 'OAuth 1.0a (Permanent)' : hasOAuth2 ? 'OAuth 2.0 User Context' : 'None',
      isFullyConfigured: hasOAuth1 || hasOAuth2,
      source: process.env.TWITTER_API_KEY ? 'environment_variables' : this.userCredentials.apiKey ? 'server_config' : 'none',
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

  public getQueue(): QueueSlot[] {
    this.syncQueue();
    return this.queue;
  }

  public rerollQueueSlot(slotId: string): QueueSlot | null {
    const idx = this.queue.findIndex(q => q.slotId === slotId);
    if (idx === -1) return null;
    const current = this.queue[idx];
    const newColor = generateColor(current.slotType);
    this.queue[idx] = {
      ...current,
      color: newColor,
    };
    this.save();
    return this.queue[idx];
  }

  public popNextQueueSlot(slotType: 'morning' | 'evening'): ColorData {
    const nextIdx = this.queue.findIndex(q => q.slotType === slotType);
    if (nextIdx !== -1) {
      const item = this.queue.splice(nextIdx, 1)[0];
      this.syncQueue();
      this.save();
      return item.color;
    }
    return generateColor(slotType);
  }

  private syncQueue() {
    const requiredCount = 14;
    const now = new Date();

    while (this.queue.length < requiredCount) {
      const slotIndex = this.queue.length;
      const dayOffset = Math.floor(slotIndex / 2);
      const isMorning = slotIndex % 2 === 0;

      const futureDate = new Date(now.getTime() + dayOffset * 86400000);
      const dateStr = futureDate.toISOString().split('T')[0];
      const timeSlot = isMorning ? '06:00' : '18:00';
      const slotType = isMorning ? 'morning' : 'evening';

      this.queue.push({
        slotId: `slot_${dateStr}_${timeSlot}`,
        dateStr,
        timeSlot,
        slotType,
        color: generateColor(slotType),
      });
    }
  }
}

export const storage = new StorageService();
