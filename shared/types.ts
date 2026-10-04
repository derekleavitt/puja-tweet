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

export interface TweetContext {
  id: string; // Unique context ID e.g. 'ctx_default', 'ctx_1790623000'
  name: string; // Context title e.g. 'Primary Eternal Colors'
  description?: string;
  targetTweetId: string; // The numeric Tweet ID to reply to (root post)
  replyTargetMode?: 'original_post' | 'last_comment'; // 'original_post' = reply to root post; 'last_comment' = cascading reply to last comment made by us
  engagementMode?: 'reply' | 'quote' | 'standalone'; // 'reply' = comment thread, 'quote' = Quote Tweet (embeds post), 'standalone' = timeline post
  autoFallbackToQuote?: boolean; // Default false. If true, a reply X refuses (cooldown / reply-restricted 403) is retried once as a quote of targetTweetId
  lastPostedTweetId?: string; // Latest tweet ID generated and posted in this campaign
  enabled: boolean; // Whether automatic scheduling is active for this context
  dryRun?: boolean; // Dry-run simulation vs live posting on X
  schedule: TweetContextSchedule;
  template: string; // Tweet text template with variables
  themePreference: 'dynamic' | 'vibrant' | 'minimal' | 'poetic';
  lastPostedTimestamp?: number;
  currentJitterMs?: number;
  lastPostedSlot?: string;
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
}
