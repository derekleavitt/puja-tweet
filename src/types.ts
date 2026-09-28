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

export interface BotSettings {
  targetTweetId: string;
  scheduleTimes: string[];
  timezone: string;
  schedulerEnabled: boolean;
  dryRun: boolean;
  template: string;
  themePreference: 'dynamic' | 'vibrant' | 'minimal' | 'poetic';
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
  slotTime: string;
  label: string;
  isMorning: boolean;
  secondsUntil: number;
  countdownFormatted: string;
  targetTimezone: string;
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
