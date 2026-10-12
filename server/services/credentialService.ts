/**
 * The X app's own keys (env vars take precedence over stored ones) and the webhook secret.
 * Only app-level keys live here: the consumer key/secret (needed to connect accounts and to sign
 * as them) and an optional app-only bearer token. Every account's user tokens belong to the
 * connected account itself (accountService); there is no built-in default account.
 */

import crypto from 'crypto';
import { HttpError } from '../middleware/error.js';
import { decrypt, encrypt, getEncryptionKey } from './credentialCrypto.js';
import type { TwitterCredentials } from '../twitterClient.js';
import type { StateManager } from './stateManager.js';

/** Shows only `••••` plus the last 2 characters (nothing for short values). */
export const mask = (val?: string) => {
  if (!val) return null;
  if (val.length < 12) return '••••';
  return `••••${val.substring(val.length - 2)}`;
};

/** The app keys: consumer key/secret and an optional app-only bearer token. */
export type AppKeys = Pick<TwitterCredentials, 'apiKey' | 'apiSecret' | 'bearerToken'>;
type CredentialField = keyof AppKeys;

const FIELD_ENV: Record<CredentialField, string> = {
  apiKey: 'TWITTER_API_KEY',
  apiSecret: 'TWITTER_API_SECRET',
  bearerToken: 'TWITTER_BEARER_TOKEN',
};
export const CREDENTIAL_FIELDS = Object.keys(FIELD_ENV) as CredentialField[];
const FIELDS = CREDENTIAL_FIELDS;

const METHOD_FIELDS: Record<string, CredentialField[]> = {
  app: ['apiKey', 'apiSecret'],
  bearer: ['bearerToken'],
};

export class CredentialService {
  /** UI-entered keys in plaintext, memory only. On disk they exist only as an encrypted blob. */
  private stored: AppKeys = {};

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
        const creds: Record<string, string> = data.creds ?? {};
        for (const f of FIELDS) if (creds[f]) this.stored[f] = creds[f];
        // Older stores also held user tokens of the removed default account: drop them.
        if (Object.keys(creds).some((k) => !(FIELDS as string[]).includes(k))) {
          this.writeStored();
          console.warn('[Credentials] Dropped stored user tokens (accounts are connected now).');
        }
      } catch {
        console.error('[Credentials] Could not decrypt stored credentials (wrong key?); ignoring.');
      }
      return;
    }
    // Legacy plaintext from an older data file: migrate to the encrypted form, or drop it from disk.
    const legacy: AppKeys = {};
    for (const f of FIELDS) if (persisted[f]) legacy[f] = persisted[f];
    if (Object.keys(legacy).length === 0) {
      if (Object.keys(persisted).length) this.writeStored(); // only old user tokens: drop them
      return;
    }
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
      key && hasAny ? { encrypted: encrypt(JSON.stringify({ creds: this.stored }), key) } : {};
    this.sm.persist();
  }

  get canPersist(): boolean {
    return getEncryptionKey() !== null;
  }

  /** The app keys in effect (env first, then UI-entered). */
  getEffectiveCredentials(): AppKeys {
    const pick = (f: CredentialField) => process.env[FIELD_ENV[f]] || this.stored[f] || '';
    return {
      apiKey: pick('apiKey'),
      apiSecret: pick('apiSecret'),
      bearerToken: pick('bearerToken'),
    };
  }

  getMaskedCredentialsStatus() {
    const creds = this.getEffectiveCredentials();
    const fromEnv = FIELDS.some((f) => !!process.env[FIELD_ENV[f]]);
    const fromStore = FIELDS.some((f) => !!this.stored[f]);
    return {
      hasApiKey: !!creds.apiKey,
      apiKeyMasked: mask(creds.apiKey),
      hasApiSecret: !!creds.apiSecret,
      hasBearerToken: !!creds.bearerToken,
      bearerTokenMasked: mask(creds.bearerToken),
      /** The app can connect accounts and sign as them. */
      isFullyConfigured: !!(creds.apiKey && creds.apiSecret),
      source: fromEnv ? 'environment_variables' : fromStore ? 'server_config' : 'none',
      canPersistCredentials: this.canPersist,
    };
  }

  /**
   * Merges UI-entered credentials into the stored set. `undefined` and blank values are ignored
   * (blank means "keep existing"); fields provided by env vars are never stored or overwritten.
   */
  updateCredentials(creds: Partial<Record<CredentialField, unknown>>) {
    const updates: Partial<Record<CredentialField, string>> = {};
    for (const f of FIELDS) {
      const v = typeof creds[f] === 'string' ? (creds[f] as string).trim() : '';
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
    this.writeStored();
  }

  /** Removes the stored credentials of one auth method (env-provided values are untouched). */
  clearCredentials(method: string) {
    const fields = METHOD_FIELDS[method];
    if (!fields) throw new HttpError(400, `Unknown credential method "${method}".`);
    for (const f of fields) delete this.stored[f];
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
