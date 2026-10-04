/**
 * X API credentials (env vars take precedence over stored ones) and the webhook secret.
 */

import crypto from 'crypto';
import { HttpError } from '../middleware/error.js';
import type { RefreshedTokens, TwitterCredentials } from '../twitterClient.js';
import type { StateManager } from './stateManager.js';

/** Shows only `••••` plus the last 2 characters (nothing for short values). */
export const mask = (val?: string) => {
  if (!val) return null;
  if (val.length < 12) return '••••';
  return `••••${val.substring(val.length - 2)}`;
};

type CredentialField = Exclude<keyof TwitterCredentials, 'encrypted' | 'onTokensRefreshed'>;

const FIELD_ENV: Record<CredentialField, string> = {
  apiKey: 'TWITTER_API_KEY',
  apiSecret: 'TWITTER_API_SECRET',
  accessToken: 'TWITTER_ACCESS_TOKEN',
  accessTokenSecret: 'TWITTER_ACCESS_TOKEN_SECRET',
  oauth2ClientId: 'TWITTER_OAUTH2_CLIENT_ID',
  oauth2ClientSecret: 'TWITTER_OAUTH2_CLIENT_SECRET',
  oauth2AccessToken: 'TWITTER_OAUTH2_ACCESS_TOKEN',
  oauth2RefreshToken: 'TWITTER_OAUTH2_REFRESH_TOKEN',
  bearerToken: 'TWITTER_BEARER_TOKEN',
};
const FIELDS = Object.keys(FIELD_ENV) as CredentialField[];

const METHOD_FIELDS: Record<string, CredentialField[]> = {
  oauth1: ['apiKey', 'apiSecret', 'accessToken', 'accessTokenSecret'],
  oauth2: ['oauth2ClientId', 'oauth2ClientSecret', 'oauth2AccessToken', 'oauth2RefreshToken'],
  bearer: ['bearerToken'],
};

const BLOB_PREFIX = 'enc:v1:';

/** AES-256-GCM key from `CREDENTIALS_ENCRYPTION_KEY` (32 bytes as 64 hex chars or base64), or null. */
const getEncryptionKey = (): Buffer | null => {
  const raw = (process.env.CREDENTIALS_ENCRYPTION_KEY || '').trim();
  if (!raw) return null;
  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    console.error('[Credentials] CREDENTIALS_ENCRYPTION_KEY must be 32 bytes (hex or base64).');
    return null;
  }
  return key;
};

const encrypt = (plain: string, key: Buffer): string => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `${BLOB_PREFIX}${[iv, cipher.getAuthTag(), ct].map((b) => b.toString('base64')).join(':')}`;
};

const decrypt = (blob: string, key: Buffer): string => {
  const [iv, tag, ct] = blob
    .slice(BLOB_PREFIX.length)
    .split(':')
    .map((p) => Buffer.from(p, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
};

export class CredentialService {
  /** UI-entered credentials in plaintext, memory only. On disk they exist only as an encrypted blob. */
  private stored: TwitterCredentials = {};
  /** True once an OAuth 2.0 refresh rotated the tokens: they then win over env values (which go stale). */
  private rotated = false;

  constructor(private readonly sm: StateManager) {
    this.loadStored();
  }

  private loadStored() {
    const persisted = this.sm.state.credentials;
    const key = getEncryptionKey();
    if (persisted.encrypted) {
      if (!key) {
        console.error(
          '[Credentials] Stored credentials are encrypted but CREDENTIALS_ENCRYPTION_KEY is not set; ignoring them.',
        );
        return;
      }
      try {
        const data = JSON.parse(decrypt(persisted.encrypted, key));
        this.stored = data.creds ?? {};
        this.rotated = !!data.rotated;
      } catch {
        console.error('[Credentials] Could not decrypt stored credentials (wrong key?); ignoring.');
      }
      return;
    }
    // Legacy plaintext from an older data file: migrate to the encrypted form, or drop it from disk.
    const legacy: TwitterCredentials = {};
    for (const f of FIELDS) if (persisted[f]) legacy[f] = persisted[f];
    if (Object.keys(legacy).length === 0) return;
    this.stored = legacy;
    this.writeStored();
    console.warn(
      key
        ? '[Credentials] Migrated plaintext credentials to encrypted storage.'
        : '[Credentials] Removed plaintext credentials from disk; set CREDENTIALS_ENCRYPTION_KEY to persist UI-entered credentials (kept in memory until restart).',
    );
  }

  /** Writes the encrypted blob (or nothing when no key is configured) into the persisted state. */
  private writeStored() {
    const key = getEncryptionKey();
    const hasAny = FIELDS.some((f) => this.stored[f]);
    this.sm.state.credentials =
      key && hasAny
        ? { encrypted: encrypt(JSON.stringify({ creds: this.stored, rotated: this.rotated }), key) }
        : {};
    this.sm.persist();
  }

  get canPersist(): boolean {
    return getEncryptionKey() !== null;
  }

  getEffectiveCredentials(): TwitterCredentials {
    const pick = (f: CredentialField) => process.env[FIELD_ENV[f]] || this.stored[f] || '';
    const pickOAuth2 = (f: 'oauth2AccessToken' | 'oauth2RefreshToken') =>
      this.rotated && this.stored[f] ? this.stored[f]! : pick(f);
    return {
      apiKey: pick('apiKey'),
      apiSecret: pick('apiSecret'),
      accessToken: pick('accessToken'),
      accessTokenSecret: pick('accessTokenSecret'),
      oauth2ClientId: pick('oauth2ClientId'),
      oauth2ClientSecret: pick('oauth2ClientSecret'),
      oauth2AccessToken: pickOAuth2('oauth2AccessToken'),
      oauth2RefreshToken: pickOAuth2('oauth2RefreshToken'),
      bearerToken: pick('bearerToken'),
      onTokensRefreshed: (tokens) => this.persistRefreshedTokens(tokens),
    };
  }

  /** Called by the X client after an OAuth 2.0 refresh; X rotates refresh tokens, so keep the new pair. */
  persistRefreshedTokens(tokens: RefreshedTokens) {
    this.stored.oauth2AccessToken = tokens.accessToken;
    if (tokens.refreshToken) this.stored.oauth2RefreshToken = tokens.refreshToken;
    this.rotated = true;
    if (!this.canPersist) {
      console.warn(
        '[Credentials] Refreshed OAuth 2.0 tokens kept in memory only (CREDENTIALS_ENCRYPTION_KEY not set).',
      );
    }
    this.writeStored();
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
    const fromEnv = FIELDS.some((f) => !!process.env[FIELD_ENV[f]]);
    const fromStore = FIELDS.some((f) => !!this.stored[f]);

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
      source: fromEnv ? 'environment_variables' : fromStore ? 'server_config' : 'none',
      canPersistCredentials: this.canPersist,
    };
  }

  /**
   * Merges UI-entered credentials into the stored set. `undefined` and blank values are ignored
   * (blank means "keep existing"); fields provided by env vars are never stored or overwritten.
   */
  updateCredentials(creds: Partial<TwitterCredentials>) {
    const updates: Partial<Record<CredentialField, string>> = {};
    for (const f of FIELDS) {
      const v = typeof creds[f] === 'string' ? creds[f]!.trim() : '';
      if (v && !process.env[FIELD_ENV[f]]) updates[f] = v;
    }
    if (Object.keys(updates).length === 0) return;
    if (!this.canPersist) {
      throw new HttpError(
        400,
        'Credentials cannot be saved from the UI because CREDENTIALS_ENCRYPTION_KEY is not set. Provide the X keys as environment variables (e.g. from Secret Manager) instead.',
      );
    }
    Object.assign(this.stored, updates);
    if (updates.oauth2AccessToken || updates.oauth2RefreshToken) this.rotated = false;
    this.writeStored();
  }

  /** Removes the stored credentials of one auth method (env-provided values are untouched). */
  clearCredentials(method: string) {
    const fields = METHOD_FIELDS[method];
    if (!fields) throw new HttpError(400, `Unknown credential method "${method}".`);
    for (const f of fields) delete this.stored[f];
    if (method === 'oauth2') this.rotated = false;
    this.writeStored();
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
