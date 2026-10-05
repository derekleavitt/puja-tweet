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
  XAccountInfo,
} from '../../shared/types.js';

/** A connected X account as persisted. `encrypted` holds `{ accessToken, accessTokenSecret }`. */
export interface XAccount extends Omit<XAccountInfo, 'isDefault'> {
  encrypted: string;
}

/** Cached facts about the default (env-token) account; its tokens are never stored. */
export type DefaultAccountMeta = Partial<
  Pick<XAccountInfo, 'handle' | 'userId' | 'status' | 'lastVerifiedAt' | 'lastError'>
>;

/** A request token waiting for the owner to authorize it on X (10-minute TTL). */
export interface PendingOAuth {
  oauthToken: string;
  /** Encrypted request-token secret. */
  encrypted: string;
  mode: 'redirect' | 'pin';
  createdAt: number;
}

/** X reply cooldown of one account. */
export interface AccountCooldown {
  untilMs: number;
  reason: string;
  lastThrottledAt: string;
}

export interface BotState {
  settings: BotSettings;
  contexts: TweetContext[];
  /** '' when there are no campaigns. */
  activeContextId: string;
  /**
   * True once the first-run primary campaign was created (or the store already had campaigns), so
   * a store the owner emptied on purpose stays empty after a restart.
   */
  campaignsSeeded?: boolean;
  logs: PostLog[];
  queue: QueueSlot[];
  credentials: TwitterCredentials;
  /** Connected X accounts (the default env-token account is synthesised, not stored here). */
  accounts: XAccount[];
  defaultAccount?: DefaultAccountMeta;
  pendingOAuth: PendingOAuth[];
  /** X cooldown of the DEFAULT account (kept as scalars for older state files). */
  cooldownUntilMs: number;
  cooldownReason: string;
  lastThrottledAt: string;
  /** Last live post of the DEFAULT account (anti-burst spacing). */
  lastGlobalLivePostTimestamp: number;
  /** Cooldown / last live post of connected accounts, keyed by account id. */
  accountCooldowns?: Record<string, AccountCooldown>;
  lastLivePostByAccount?: Record<string, number>;
  lastCapturedRateLimitHeaders?: RateLimitHeaders;
  lastRateLimitCaptureTimestamp?: number;
  /** The X account those headers came from (they are per user); undefined = default account. */
  lastRateLimitAccountId?: string;
  /** Gemini calls made on `day` (UTC), so GEMINI_MAX_CALLS_PER_DAY survives restarts. */
  geminiUsage?: { day: string; calls: number };
}

export interface Store {
  /** Returns the persisted state with defaults applied (a fresh default state when nothing is stored). */
  load(): Promise<BotState>;
  /** Persists the full state. Implementations must not retain references to the passed object. */
  save(state: BotState): Promise<void>;
  /** Optional synchronous save used only for the shutdown flush (SIGTERM/SIGINT). */
  saveSync?(state: BotState): void;
}
