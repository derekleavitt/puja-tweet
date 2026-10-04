/**
 * X API credentials (env vars take precedence over stored ones) and the webhook secret.
 */

import crypto from 'crypto';
import type { TwitterCredentials } from '../twitterClient.js';
import type { StateManager } from './stateManager.js';

const mask = (val?: string) => {
  if (!val) return null;
  if (val.length <= 6) return '••••••';
  return `${val.substring(0, 3)}••••${val.substring(val.length - 3)}`;
};

export class CredentialService {
  constructor(private readonly sm: StateManager) {}

  getEffectiveCredentials(): TwitterCredentials {
    const stored = this.sm.state.credentials;
    return {
      apiKey: process.env.TWITTER_API_KEY || stored.apiKey || '',
      apiSecret: process.env.TWITTER_API_SECRET || stored.apiSecret || '',
      accessToken: process.env.TWITTER_ACCESS_TOKEN || stored.accessToken || '',
      accessTokenSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET || stored.accessTokenSecret || '',
      oauth2ClientId: process.env.TWITTER_OAUTH2_CLIENT_ID || stored.oauth2ClientId || '',
      oauth2ClientSecret:
        process.env.TWITTER_OAUTH2_CLIENT_SECRET || stored.oauth2ClientSecret || '',
      oauth2AccessToken: process.env.TWITTER_OAUTH2_ACCESS_TOKEN || stored.oauth2AccessToken || '',
      oauth2RefreshToken:
        process.env.TWITTER_OAUTH2_REFRESH_TOKEN || stored.oauth2RefreshToken || '',
      bearerToken: process.env.TWITTER_BEARER_TOKEN || stored.bearerToken || '',
    };
  }

  getMaskedCredentialsStatus() {
    const creds = this.getEffectiveCredentials();
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
        : this.sm.state.credentials.apiKey
          ? 'server_config'
          : 'none',
    };
  }

  updateCredentials(creds: Partial<TwitterCredentials>) {
    this.sm.state.credentials = { ...this.sm.state.credentials, ...creds };
    this.sm.persist();
  }

  // --- Webhook secret (never part of getSettings) ---

  ensureWebhookSecret() {
    if (process.env.WEBHOOK_SECRET || this.sm.state.settings.webhookSecret) return;
    this.sm.state.settings.webhookSecret = crypto.randomBytes(32).toString('hex');
    this.sm.persist();
    console.log(
      '[Credentials] Generated a new webhook secret (stored in the data file; fetch it via GET /api/webhook/url).',
    );
  }

  getWebhookSecret(): string {
    return process.env.WEBHOOK_SECRET || this.sm.state.settings.webhookSecret || '';
  }

  rotateWebhookSecret(): string {
    this.sm.state.settings.webhookSecret = crypto.randomBytes(32).toString('hex');
    this.sm.persist();
    console.log('[Credentials] Webhook secret rotated.');
    return this.getWebhookSecret();
  }
}
