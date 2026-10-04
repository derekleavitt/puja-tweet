/**
 * Persistence contract for X ChromaBot.
 * Services own all domain logic and only ever read/write whole `BotState` snapshots through
 * a `Store`, so the backing medium (JSON file, in-memory, Firestore) is swappable.
 */

import type { TwitterCredentials } from '../twitterClient.js';
import type {
  BotSettings,
  PostLog,
  QueueSlot,
  RateLimitHeaders,
  TweetContext,
} from '../../shared/types.js';

export interface BotState {
  settings: BotSettings;
  contexts: TweetContext[];
  activeContextId: string;
  logs: PostLog[];
  queue: QueueSlot[];
  credentials: TwitterCredentials;
  cooldownUntilMs: number;
  cooldownReason: string;
  lastThrottledAt: string;
  lastGlobalLivePostTimestamp: number;
  lastCapturedRateLimitHeaders?: RateLimitHeaders;
  lastRateLimitCaptureTimestamp?: number;
}

export interface Store {
  /** Returns the persisted state with defaults applied (a fresh default state when nothing is stored). */
  load(): Promise<BotState>;
  /** Persists the full state. Implementations must not retain references to the passed object. */
  save(state: BotState): Promise<void>;
}
