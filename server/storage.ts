/**
 * Storage manager for X ChromaBot
 * Manages configuration, upcoming queue, post logs, and state persistence.
 */

import fs from 'fs';
import path from 'path';
import { ColorData, DEFAULT_TWEET_TEMPLATE, generateColor } from './colorEngine.js';
import { TwitterCredentials } from './twitterClient.js';

export interface BotSettings {
  targetTweetId: string;
  scheduleTimes: string[]; // e.g. ["06:00", "18:00"]
  timezone: string; // e.g. "America/Los_Angeles"
  schedulerEnabled: boolean;
  dryRun: boolean;
  template: string;
  themePreference: 'dynamic' | 'vibrant' | 'minimal' | 'poetic';
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
}

export interface QueueSlot {
  slotId: string;
  dateStr: string;
  timeSlot: '06:00' | '18:00' | string;
  slotType: 'morning' | 'evening';
  color: ColorData;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const STORE_FILE = path.join(DATA_DIR, 'bot-store.json');

const DEFAULT_SETTINGS: BotSettings = {
  targetTweetId: process.env.TARGET_TWEET_ID || '2103110008212992249',
  scheduleTimes: (process.env.SCHEDULE_TIMES || '06:00,18:00').split(',').map(s => s.trim()),
  timezone: process.env.SCHEDULE_TIMEZONE || 'America/Los_Angeles',
  schedulerEnabled: true,
  dryRun: false,
  template: DEFAULT_TWEET_TEMPLATE,
  themePreference: 'dynamic',
};

class StorageService {
  private settings: BotSettings;
  private logs: PostLog[] = [];
  private queue: QueueSlot[] = [];
  private lastPostedSlot: string = '';
  private userCredentials: TwitterCredentials = {};

  constructor() {
    this.settings = { ...DEFAULT_SETTINGS };
    this.ensureDataDir();
    this.load();
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

  private load() {
    try {
      if (fs.existsSync(STORE_FILE)) {
        const raw = fs.readFileSync(STORE_FILE, 'utf-8');
        const data = JSON.parse(raw);
        if (data.settings) {
          this.settings = { ...DEFAULT_SETTINGS, ...data.settings };
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
        if (data.credentials) {
          this.userCredentials = data.credentials;
        }
      }
    } catch (err) {
      console.warn('Could not read bot store file, using in-memory defaults:', err);
    }
  }

  public save() {
    try {
      this.ensureDataDir();
      const payload = {
        settings: this.settings,
        logs: this.logs.slice(-100), // keep latest 100 logs
        queue: this.queue,
        lastPostedSlot: this.lastPostedSlot,
        credentials: this.userCredentials,
      };
      fs.writeFileSync(STORE_FILE, JSON.stringify(payload, null, 2), 'utf-8');
    } catch (err) {
      console.error('Error saving bot store:', err);
    }
  }

  public getSettings(): BotSettings {
    return { ...this.settings };
  }

  public updateSettings(newSettings: Partial<BotSettings>): BotSettings {
    if (newSettings.targetTweetId) {
      // Extract numeric tweet ID if a full URL or string with query params was pasted
      const matched = newSettings.targetTweetId.match(/\b\d{10,25}\b/);
      if (matched) {
        newSettings.targetTweetId = matched[0];
      } else {
        newSettings.targetTweetId = newSettings.targetTweetId.trim();
      }
    }
    this.settings = { ...this.settings, ...newSettings };
    this.save();
    return this.settings;
  }

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
    // Keep next 14 slots populated (7 days * 2 times: 6am & 6pm)
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
