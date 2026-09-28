export interface ColorData {
  id: string;
  name: string;
  colorPick?: string;
  hex: string;
  rgb: { r: number; g: number; b: number };
  hsl: { h: number; s: number; l: number };
  cmyk: { c: number; m: number; y: number; k: number };
  mood: string;
  weatherDesc?: string;
  weatherTweet?: string;
  slotType: 'morning' | 'evening' | 'custom';
  companions: string[];
  swatchBar: string;
  contrastText: '#000000' | '#FFFFFF';
}

export interface TweetContextSchedule {
  mode: 'interval' | 'fixed_times';
  intervalMinutes: number; // e.g. 1, 15, 30, 60, 180, 360, 720
  scheduleTimes: string[]; // e.g. ["06:00", "18:00"]
  timezone: string; // e.g. "America/Los_Angeles"
  humanizeJitterEnabled: boolean; // Random humanized anti-bot delay
  jitterPercentage: number; // Default 25 (0 to 25% of interval window)
}

export interface TweetContext {
  id: string; // Unique context ID e.g. 'ctx_default', 'ctx_1790623000'
  name: string; // Context title e.g. 'Primary Eternal Colors'
  description?: string;
  targetTweetId: string; // The numeric Tweet ID to reply to
  enabled: boolean; // Whether automatic scheduling is active for this context
  dryRun?: boolean; // Dry-run simulation vs live posting on X
  schedule: TweetContextSchedule;
  template: string; // Tweet text template with variables
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
  intervalMinutes?: number; // 1, 15, 30, 60, 180, 360, 540, 720
  webhookSecret?: string;
  humanizeJitterEnabled?: boolean; // Randomized humanized delay
  jitterPercentage?: number; // default 25% (0% - 25% window delay)
  activeContextId?: string; // Current active context selected in Studio
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
