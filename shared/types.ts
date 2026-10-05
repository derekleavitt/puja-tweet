/**
 * Shared domain types for X ChromaBot.
 * Single source of truth imported by the server and the client (via src/types.ts).
 * Must stay isomorphic: no Node or DOM APIs, no imports from server/ or src/.
 */

export interface ColorData {
  id: string;
  name: string;
  colorPick: string; // e.g. "Sunrise Amber" or "Sunset Violet"
  hex: string;
  rgb: { r: number; g: number; b: number };
  hsl: { h: number; s: number; l: number };
  cmyk: { c: number; m: number; y: number; k: number };
  mood: string;
  weatherDesc: string; // e.g. "warming crisp morning air" (3-5 words)
  weatherTweet: string; // e.g. "Sunrise Amber warming crisp morning air #eternal #colors"
  slotType: 'morning' | 'evening' | 'custom';
  companions: string[];
  swatchBar: string;
  contrastText: '#000000' | '#FFFFFF';
}

export interface TweetContextSchedule {
  mode: 'interval' | 'fixed_times';
  intervalMinutes: number; // e.g. 1, 15, 30, 60, 180, 360, 720
  scheduleTimes: string[]; // e.g. ["06:00", "18:00"]
  timezone: string; // e.g. "America/Denver" (MST)
  humanizeJitterEnabled: boolean; // Random humanized anti-bot delay
  jitterPercentage: number; // Default 25 (0 to 25% of interval window)
}

/** Per-campaign "evolving hashtags" settings (client-editable). */
export interface HashtagEvolutionConfig {
  enabled: boolean;
  maxTags: number; // 1-5, default 3 (kept seed tags count toward it)
  keepSeedTags: boolean; // Default false. true = some of the campaign's own `hashtags` are always kept
}

/** Server-owned evolving-hashtag state; only advanced after a successful (live or simulated) post. */
export interface HashtagState {
  current: string[]; // Tags used by the latest post (without '#')
  recent: string[]; // Last ~40 tags used, so they are not repeated
}

/**
 * Provenance of a campaign's reply-chain anchor. Written only by the server when THIS campaign
 * posted a live in-thread reply on THIS target, so the chain can be verified without the shared
 * (capped) post log. An anchor without provenance is never followed.
 */
export interface ChainAnchor {
  tweetId: string; // Our own reply the next drop replies to
  targetTweetId: string; // The root post the chain belongs to
  postedAt: string; // ISO timestamp of that reply
}

/** The account behind the env tokens (TWITTER_ACCESS_TOKEN/SECRET); campaigns without `accountId` use it. */
export const DEFAULT_ACCOUNT_ID = 'acct_env';

export type XAccountStatus = 'ok' | 'revoked' | 'unverified';

/** Public view of an X account a campaign can post as. Never carries tokens. */
export interface XAccountInfo {
  id: string; // 'acct_env' for the default (env) account, 'acct_<userId>' for connected ones
  label: string;
  handle: string; // Without '@'; '' until the default account was verified
  userId: string;
  status: XAccountStatus;
  lastVerifiedAt?: string;
  lastError?: string;
  createdAt: string;
  /** True for the env-token account: verify only (no rename / remove). */
  isDefault: boolean;
}

/** One voice of a conversation campaign: a connected account (or 'acct_env') and its persona. */
export interface ConversationParticipant {
  accountId: string;
  persona: string;
}

/** Client-editable setup of a conversation campaign (several accounts replying in one thread). */
export interface ConversationConfig {
  participants: ConversationParticipant[]; // 2-5, unique accountId
  sharedPrompt: string; // Premise / tone shared by every participant
  openingPost: string; // The owner's own reply text (= the campaign's targetTweetId)
  openerHandle?: string; // Without '@'; the account that posted the opening post
  firstSpeakerAccountId?: string; // undefined = random participant
  maxTurns?: number; // undefined = unlimited, else 1-500
}

/** Server-owned conversation progress (never accepted from clients). */
export interface ConversationState {
  runId: string; // 'run_<ts>'; a restart (or new target) creates a new one
  turnCount: number; // Posted (live or simulated) turns in this run
  roundStartTurn?: number; // turnCount when the current round began (resuming a finished run)
  nextSpeakerAccountId: string; // Chosen BEFORE the turn is written
  /** Covers turns 1..summaryThroughTurn (everything no longer in `turns`). */
  summary?: string;
  summaryThroughTurn?: number;
  /**
   * The run's own transcript buffer, independent of the shared (capped) post log: every posted
   * turn after `summaryThroughTurn`, oldest first, bounded. Invariant: `summary` + `turns` cover
   * turns 1..turnCount with no gap. Undefined on legacy state (seeded from the logs on first use).
   */
  turns?: ConversationTurnRecord[];
}

/** One posted (or simulated) conversation turn as kept on the campaign. */
export interface ConversationTurnRecord {
  turn: number;
  accountId: string;
  handle: string;
  /** At most 300 characters. */
  text: string;
  tweetId?: string;
  at: string; // ISO time
}

/** One successful live post of a single-mode campaign, kept for `<history>` agent prompts. */
export interface RecentPost {
  /** At most 300 characters. */
  text: string;
  tweetId?: string;
  at: string; // ISO time
  slotType?: 'morning' | 'evening' | 'manual';
  colorName?: string;
  colorHex?: string;
}

/** Server-owned retry state after a failed post (cleared by a success or a resume). */
export interface RetryState {
  /** Epoch ms of the next attempt (the scheduler fires the campaign again at this time). */
  at: number;
  /** Short human reason, e.g. "AI busy", "X server error", "last post failed". */
  reason: string;
  /** Transient failures (AI unavailable, X 5xx, network) never auto-pause the campaign. */
  transient: boolean;
  /** Consecutive transient failures (drives the exponential back-off). */
  attempt: number;
  /** Fixed-time campaigns: the slot being retried, and when it was first attempted. */
  slotKey?: string;
  since?: number;
}

/** Persisted before a post is sent to X and cleared with its result (crash detection). */
export interface InFlightPost {
  startedAt: number;
  /** Process that sent it (a fresh marker from another process means "still posting"). */
  bootId: string;
  runId?: string;
  turn?: number;
  replyToTweetId?: string;
  text?: string;
}

export interface TweetContext {
  id: string; // Unique context ID e.g. 'ctx_default', 'ctx_1790623000'
  name: string; // Context title e.g. 'Primary Eternal Colors'
  description?: string;
  /** X account this campaign posts as (see `XAccountInfo`); undefined = the default account. */
  accountId?: string;
  targetTweetId: string; // The numeric Tweet ID to reply to (root post)
  replyTargetMode?: 'original_post' | 'last_comment'; // 'original_post' = reply to root post; 'last_comment' = cascading reply to last comment made by us
  engagementMode?: 'reply' | 'quote' | 'standalone'; // 'reply' = comment thread, 'quote' = Quote Tweet (embeds post), 'standalone' = timeline post
  autoFallbackToQuote?: boolean; // Default false. If true, a reply X refuses (cooldown / reply-restricted 403) is retried once as a quote of targetTweetId
  lastPostedTweetId?: string; // Latest tweet ID generated and posted in this campaign (= chainAnchor.tweetId)
  chainAnchor?: ChainAnchor; // Server-owned proof of `lastPostedTweetId` (never accepted from clients)
  enabled: boolean; // Whether automatic scheduling is active for this context
  dryRun?: boolean; // Dry-run simulation vs live posting on X
  schedule: TweetContextSchedule;
  template: string; // Tweet text template with variables
  themePreference: 'dynamic' | 'vibrant' | 'minimal' | 'poetic';
  /** The campaign's own hashtags (no '#', max 10), appended after the template body. Undefined = not migrated yet. */
  hashtags?: string[];
  hashtagEvolution?: HashtagEvolutionConfig; // Default off
  hashtagState?: HashtagState; // Server-owned (never accepted from clients)
  /** undefined = 'single'. In 'conversation' mode several accounts take turns (see `conversation`). */
  mode?: 'single' | 'conversation';
  conversation?: ConversationConfig;
  conversationState?: ConversationState; // Server-owned (never accepted from clients)
  lastPostedTimestamp?: number;
  currentJitterMs?: number;
  lastPostedSlot?: string;
  /** Armed fixed-time slot waiting out its jitter; persisted so a restart still fires it once. */
  pendingFire?: PendingFire;
  /** Server-owned: next retry after a failed post (see `RetryState`). */
  retry?: RetryState;
  /** Server-owned: a post that was sent to X and whose result is not recorded yet. */
  inFlight?: InFlightPost;
  /** Server-owned: last successful live posts (max 10, oldest first) for `<history>` prompts. */
  recentPosts?: RecentPost[];
  /** Persistent failures in a row (the breaker pauses at MAX_CONSECUTIVE_ERRORS). */
  consecutiveErrors?: number;
  /** Set when the circuit breaker disabled this campaign (cleared on resume). */
  autoPausedReason?: string;
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
  replyTargetMode?: 'original_post' | 'last_comment';
  engagementMode?: 'reply' | 'quote' | 'standalone';
  autoFallbackToQuote?: boolean;
  lastPostedTweetId?: string;
  scheduleTimes: string[];
  timezone: string;
  schedulerEnabled: boolean;
  dryRun: boolean;
  /** Master switch: when true (the default) no path posts live to X, whatever the campaign says. */
  globalDryRun?: boolean;
  /** Master switch: when true (the default) scheduled drops (scheduler, webhook, CLI) do not run. */
  globalPaused?: boolean;
  template: string;
  themePreference: 'dynamic' | 'vibrant' | 'minimal' | 'poetic';
  intervalMode?: 'fixed_times' | 'interval';
  intervalMinutes?: number; // 1, 15, 30, 60, 180, 360, 540, 720
  webhookSecret?: string;
  humanizeJitterEnabled?: boolean; // Randomized humanized delay
  jitterPercentage?: number; // default 25% (0% - 25% window delay)
  activeContextId?: string; // Current active context selected in Studio
}

export interface CooldownState {
  isThrottled: boolean;
  throttledUntil: number; // epoch ms
  secondsRemaining: number;
  reason?: string;
  source?: string;
  lastThrottledAt?: string;
}

export interface RateLimitHeaders {
  limit?: number;
  remaining?: number;
  reset?: number; // epoch timestamp in seconds
  appDailyLimit?: number;
  userDailyLimit?: number;
  retryAfter?: number;
}

export interface RateLimitTelemetry {
  limit: number; // e.g. 50
  remaining: number; // e.g. 48
  resetEpochSeconds: number; // epoch timestamp seconds
  resetDateIso: string;
  secondsUntilReset: number;
  status: 'optimal' | 'warning' | 'throttled';
  postsLast24Hours: number;
  estimatedDailyCap: number; // 17 (Free), 100 (Basic), 10000 (Pay-Per-Use)
  lastUpdatedIso: string;
  tierDetected:
    | 'Free (Legacy)'
    | 'Basic ($200/mo)'
    | 'Pay-Per-Use ($0.015/tweet)'
    | 'Pro ($5k/mo)'
    | 'Enterprise';
  headersCaptured: boolean;
  activeCooldown?: CooldownState;
}

export interface CredentialsStatus {
  hasApiKey: boolean;
  apiKeyMasked: string | null;
  hasApiSecret: boolean;
  hasAccessToken: boolean;
  accessTokenMasked: string | null;
  hasAccessTokenSecret: boolean;
  hasOAuth2ClientId: boolean;
  oauth2ClientIdMasked: string | null;
  hasOAuth2ClientSecret: boolean;
  hasOAuth2AccessToken: boolean;
  hasOAuth2RefreshToken: boolean;
  hasBearerToken: boolean;
  authMethod: string;
  isFullyConfigured: boolean;
  source: 'environment_variables' | 'server_config' | 'none';
  /** False when CREDENTIALS_ENCRYPTION_KEY is unset: UI-entered credentials cannot be saved. */
  canPersistCredentials: boolean;
}

export interface NextPostInfo {
  contextId?: string;
  contextName?: string;
  slotTime: string;
  label: string;
  isMorning: boolean;
  secondsUntil: number;
  countdownFormatted: string;
  targetTimezone: string;
  jitterSeconds?: number;
  jitterFormatted?: string;
  /** Why the scheduler will not post this campaign right now (paused, cooldown, …); absent when free to post. */
  blockedReason?: string;
  /** Handle of the next speaker (conversation campaigns). */
  speakerHandle?: string;
}

export interface PostLog {
  id: string;
  timestamp: string;
  slotType: 'morning' | 'evening' | 'manual';
  scheduledTime?: string;
  targetTweetId: string;
  replyToTweetId?: string; // The specific tweet ID that was replied to (root or cascading comment)
  quoteTweetId?: string; // If posted as Quote Tweet
  engagementMode?: 'reply' | 'quote' | 'standalone';
  color: ColorData;
  tweetText: string;
  tweetId?: string;
  tweetUrl?: string;
  status: 'success' | 'simulated' | 'error';
  errorMessage?: string;
  contextId?: string;
  contextName?: string;
  /** True when a restricted reply was retried as a quote tweet (autoFallbackToQuote). */
  fallbackTriggered?: boolean;
  /** Account the drop was posted as (absent on logs from before multi-account). */
  accountId?: string;
  accountHandle?: string;
  /** Conversation turns only (accountId/accountHandle hold the speaker). */
  conversationRunId?: string;
  turn?: number;
  nextSpeakerAccountId?: string;
}

export interface QueueSlot {
  slotId: string;
  dateStr: string;
  timeSlot: '06:00' | '18:00' | string;
  slotType: 'morning' | 'evening';
  color: ColorData;
  contextId?: string;
  contextName?: string;
  previewText?: string;
  targetTweetId?: string;
  replyTargetMode?: 'original_post' | 'last_comment';
  /** Handle of the account the campaign posts as (filled in when the queue is read). */
  accountHandle?: string;
  /** Conversation campaigns: the account that speaks in this slot (only the next one is known). */
  speakerAccountId?: string;
}

/** AI availability fields on `GET /api/status` (`geminiConfigured` is false when GEMINI_API_KEY is unset). */
export interface AiStatus {
  geminiConfigured?: boolean;
}

/** Per-campaign entry of `allNextPosts` on `GET /api/status`. */
export type ContextNextPost = NextPostInfo & { enabled: boolean; targetTweetId: string };

/** `GET /api/status` payload as consumed by the UI. */
export interface StatusResponse extends AiStatus {
  /** Server default target tweet (env TARGET_TWEET_ID); empty when unset. */
  defaultTargetTweetId?: string;
  settings: BotSettings;
  activeContext?: TweetContext | null;
  contexts?: TweetContext[];
  nextPost: NextPostInfo | null;
  allNextPosts?: ContextNextPost[];
  credentialsStatus: CredentialsStatus;
  cooldownState?: CooldownState;
  rateLimitTelemetry?: RateLimitTelemetry;
  queue?: QueueSlot[];
  /** Every account campaigns can post as (default first). */
  accounts?: XAccountInfo[];
  /** X cooldown per account id (`cooldownState` is the default account's). */
  accountCooldowns?: Record<string, CooldownState>;
}

/**
 * How a drop's text was put together (`POST /api/template/preview` -> `breakdown`), so the UI can
 * explain it. The final text is `appendTagBlock(body, hashtags)`.
 */
export interface DropTextBreakdown {
  /** Everything before the tag block: rendered template (static text + AI text). */
  body: string;
  /** The template's own text with variables filled in and AI parts left out. */
  staticText: string;
  /** The AI-written part(s) as posted (after hashtag clean-up and trimming); absent without `<agent>`. */
  aiText?: string;
  /** The appended tag block, e.g. "#Aurora #Glow" ('' when there is none). */
  tagBlock: string;
  /** Tags in the tag block (without '#'). */
  hashtags: string[];
  /** 'campaign' = the campaign's own hashtags, 'evolved' = evolution picked them, 'none' = no block. */
  tagSource: 'campaign' | 'evolved' | 'none';
  /** What evolution started from (evolution only). */
  seedSource?: 'campaign' | 'previous' | 'ai' | 'theme';
  /** AI's own trailing tags that were folded into the evolved block. */
  foldedAiTags?: string[];
  /** Hashtags the AI wrote that were taken out of its text (trailing cluster, duplicates, length). */
  removedAiHashtags?: string[];
  /** Inline AI hashtags turned into plain words ("#love" -> "love"). */
  dehashedAiHashtags?: string[];
  /** Body hashtags removed because the tag block (or earlier text) already has them. */
  removedDuplicateTags?: string[];
  /** Tags dropped from the end of the block so the tweet fits 280. */
  droppedTags?: string[];
}

/** Outcome of one post attempt: `POST /api/post-now` and `/api/contexts/:id/trigger`. */
export interface DropResponse {
  success: boolean;
  /** Set by the client when the request itself failed. */
  error?: string;
  result?: {
    success?: boolean;
    simulated?: boolean;
    url?: string;
    tweetId?: string;
    error?: string;
  };
  log?: PostLog;
  /** Evolved hashtags (without '#') used by this drop; absent when evolution is off. */
  hashtags?: string[];
}

/** `POST /api/twitter/verify` payload. */
export interface VerifyResult {
  valid: boolean;
  message?: string;
}

/** Common shape of mutation responses (`{ success, ...data }`); unlisted fields stay `unknown`. */
export interface ApiResult {
  success?: boolean;
  error?: string;
  queue?: QueueSlot[];
  contexts?: TweetContext[];
  context?: TweetContext;
  settings?: BotSettings;
  credentialsStatus?: CredentialsStatus;
  cooldownState?: CooldownState;
  telemetry?: RateLimitTelemetry;
  log?: PostLog;
  [field: string]: unknown;
}

/** `GET /api/health` payload (unauthenticated). */
export interface HealthInfo {
  ok: boolean;
  version?: string;
  /** Persistence backend the server runs on. */
  store?: 'json' | 'memory' | 'firestore';
  schedulerRunning?: boolean;
}

/** A fixed-time slot that was reached and is waiting (jitter / anti-burst) to fire. */
export interface PendingFire {
  slotKey: string;
  slotType: 'morning' | 'evening';
  matchedTime: string;
  fireAt: number;
}
