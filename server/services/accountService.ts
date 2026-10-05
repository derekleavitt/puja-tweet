/**
 * X accounts campaigns can post as.
 *
 * - The DEFAULT account (`acct_env`) is the one behind the env tokens (TWITTER_ACCESS_TOKEN/SECRET
 *   or UI-entered OAuth credentials). It is synthesised, never stored as tokens, never removable.
 * - CONNECTED accounts come from the OAuth 1.0a 3-legged flow (or its PIN variant). Only their user
 *   access token + secret differ; the consumer key/secret stay app-level. Tokens are stored
 *   encrypted with CREDENTIALS_ENCRYPTION_KEY and never leave the server.
 */

import { HttpError } from '../middleware/error.js';
import {
  oauth1AccessToken,
  oauth1AuthorizeUrl,
  oauth1RequestToken,
  verifyTwitterCredentials,
  type TwitterCredentials,
} from '../twitterClient.js';
import { DEFAULT_ACCOUNT_ID, type XAccountInfo } from '../../shared/types.js';
import type { BotState, XAccount } from '../store/Store.js';
import type { CredentialService } from './credentialService.js';
import { decryptJson, encryptJson, getEncryptionKey } from './credentialCrypto.js';
import type { StateManager } from './stateManager.js';

/** A request token must be authorized on X within this window. */
export const PENDING_OAUTH_TTL_MS = 10 * 60 * 1000;
const MAX_PENDING_OAUTH = 20;

interface AccountTokens {
  accessToken: string;
  accessTokenSecret: string;
}

const NO_KEY_MESSAGE =
  'X accounts cannot be connected because CREDENTIALS_ENCRYPTION_KEY is not set on the server (it encrypts the account tokens). Set it, restart, and try again.';

const handleLabel = (handle?: string) => (handle ? `@${handle}` : 'the selected account');

/** Treats '', undefined and 'acct_env' alike (the default account). */
export const effectiveAccountId = (id?: string | null): string => id || DEFAULT_ACCOUNT_ID;

/** Why campaigns cannot post as this account (unknown or revoked); undefined when usable. */
export const accountProblem = (state: BotState, id?: string | null): string | undefined => {
  const accountId = effectiveAccountId(id);
  if (accountId === DEFAULT_ACCOUNT_ID) return undefined;
  const account = state.accounts.find((a) => a.id === accountId);
  if (!account) {
    return 'Account is removed or disconnected — pick an account and resume';
  }
  if (account.status === 'revoked') {
    return `Account @${account.handle} is removed or disconnected — pick an account and resume`;
  }
  return undefined;
};

/** Reason used when a campaign is paused because its account went away. */
export const accountPauseReason = (handle?: string) =>
  `Account ${handleLabel(handle)} is removed or disconnected — pick an account and resume`;

const toInfo = (a: XAccount): XAccountInfo => ({
  id: a.id,
  label: a.label,
  handle: a.handle,
  userId: a.userId,
  status: a.status,
  lastVerifiedAt: a.lastVerifiedAt,
  lastError: a.lastError,
  createdAt: a.createdAt,
  isDefault: false,
});

export class AccountService {
  constructor(
    private readonly sm: StateManager,
    private readonly credentials: CredentialService,
  ) {}

  private get state() {
    return this.sm.state;
  }

  private defaultInfo(): XAccountInfo {
    const meta = this.state.defaultAccount ?? {};
    const handle = meta.handle || (process.env.X_HANDLE || '').trim().replace(/^@/, '');
    return {
      id: DEFAULT_ACCOUNT_ID,
      label: 'Default account',
      handle,
      userId: meta.userId || '',
      status: meta.status || 'unverified',
      lastVerifiedAt: meta.lastVerifiedAt,
      lastError: meta.lastError,
      createdAt: '',
      isDefault: true,
    };
  }

  /** Every account, default first. Never includes tokens. */
  list(): XAccountInfo[] {
    return [this.defaultInfo(), ...this.state.accounts.map(toInfo)];
  }

  get(id?: string | null): XAccountInfo | undefined {
    const accountId = effectiveAccountId(id);
    if (accountId === DEFAULT_ACCOUNT_ID) return this.defaultInfo();
    const found = this.state.accounts.find((a) => a.id === accountId);
    return found ? toInfo(found) : undefined;
  }

  private getStored(id: string): XAccount {
    const found = this.state.accounts.find((a) => a.id === id);
    if (!found) throw new HttpError(404, `Account ${id} not found`);
    return found;
  }

  exists(id?: string | null): boolean {
    return !!this.get(id);
  }

  handleOf(id?: string | null): string | undefined {
    return this.get(id)?.handle || undefined;
  }

  /**
   * Full credentials to post as this account, or null when the account is unknown, revoked or its
   * tokens cannot be decrypted (or the app has no consumer key). The default account returns the
   * effective app credentials as before (empty ones simulate, like they always did).
   */
  getCredentialsForAccount(id?: string | null): TwitterCredentials | null {
    const accountId = effectiveAccountId(id);
    const app = this.credentials.getEffectiveCredentials();
    if (accountId === DEFAULT_ACCOUNT_ID) return app;
    const account = this.state.accounts.find((a) => a.id === accountId);
    if (!account || account.status === 'revoked') return null;
    return this.tokenCredentials(account);
  }

  /** The account's own tokens + the app consumer key, regardless of status. */
  private tokenCredentials(account: XAccount): TwitterCredentials | null {
    const app = this.credentials.getEffectiveCredentials();
    const tokens = decryptJson<AccountTokens>(account.encrypted);
    if (!tokens?.accessToken || !tokens.accessTokenSecret || !app.apiKey || !app.apiSecret) {
      return null;
    }
    return {
      apiKey: app.apiKey,
      apiSecret: app.apiSecret,
      accessToken: tokens.accessToken,
      accessTokenSecret: tokens.accessTokenSecret,
    };
  }

  private consumer() {
    const app = this.credentials.getEffectiveCredentials();
    if (!app.apiKey || !app.apiSecret) {
      throw new HttpError(
        400,
        'The app API key and secret (TWITTER_API_KEY / TWITTER_API_SECRET) are not configured, so no X account can be connected.',
      );
    }
    return { apiKey: app.apiKey, apiSecret: app.apiSecret };
  }

  private requireKey(): Buffer {
    const key = getEncryptionKey();
    if (!key) throw new HttpError(400, NO_KEY_MESSAGE);
    return key;
  }

  /** Drops expired request tokens (and caps how many are kept). Returns true when it changed. */
  private prunePending(now = Date.now()): boolean {
    const before = this.state.pendingOAuth.length;
    this.state.pendingOAuth = this.state.pendingOAuth
      .filter((p) => now - p.createdAt < PENDING_OAUTH_TTL_MS)
      .slice(-MAX_PENDING_OAUTH);
    return this.state.pendingOAuth.length !== before;
  }

  /**
   * Step 1 of connecting an account. `callback` is an already validated absolute URL, or 'oob' for
   * the PIN flow. The request-token secret is persisted (encrypted) so a different server instance
   * can finish the flow.
   */
  async startConnect(callback: string): Promise<{ authorizeUrl: string; oauthToken: string }> {
    const key = this.requireKey();
    const consumer = this.consumer();
    const token = await oauth1RequestToken(consumer, callback);
    if (callback !== 'oob' && !token.callbackConfirmed) {
      throw new HttpError(502, 'X did not confirm the callback URL.');
    }
    this.prunePending();
    this.state.pendingOAuth.push({
      oauthToken: token.oauthToken,
      encrypted: encryptJson({ secret: token.oauthTokenSecret }, key),
      mode: callback === 'oob' ? 'pin' : 'redirect',
      createdAt: Date.now(),
    });
    await this.sm.flush();
    return { authorizeUrl: oauth1AuthorizeUrl(token.oauthToken), oauthToken: token.oauthToken };
  }

  /** Step 3: trades the authorized request token for the account's tokens and stores them. */
  async completeConnect(oauthToken: string, verifier: string): Promise<XAccountInfo> {
    const key = this.requireKey();
    const consumer = this.consumer();
    const changed = this.prunePending();
    const idx = this.state.pendingOAuth.findIndex((p) => p.oauthToken === oauthToken);
    if (idx === -1) {
      if (changed) this.sm.persist();
      throw new HttpError(
        400,
        'This connection request expired or was already used. Start "Connect account" again.',
      );
    }
    const [pending] = this.state.pendingOAuth.splice(idx, 1);
    this.sm.persist();
    const secret = decryptJson<{ secret: string }>(pending.encrypted)?.secret;
    if (!secret) throw new HttpError(400, 'The connection request could not be read. Start again.');

    let result;
    try {
      result = await oauth1AccessToken(consumer, oauthToken, secret, verifier.trim());
    } catch (err) {
      throw new HttpError(400, err instanceof Error ? err.message : String(err));
    }

    const now = new Date().toISOString();
    const encrypted = encryptJson(
      { accessToken: result.accessToken, accessTokenSecret: result.accessTokenSecret },
      key,
    );
    // Reconnecting the same X user refreshes its tokens instead of adding a duplicate.
    const existing = this.state.accounts.find((a) => a.userId === result.userId);
    if (existing) {
      Object.assign(existing, {
        handle: result.screenName || existing.handle,
        encrypted,
        status: 'ok',
        lastVerifiedAt: now,
        lastError: undefined,
      });
      await this.sm.flush();
      return toInfo(existing);
    }
    const account: XAccount = {
      id: `acct_${result.userId}`,
      label: result.screenName ? `@${result.screenName}` : `X user ${result.userId}`,
      handle: result.screenName,
      userId: result.userId,
      status: 'ok',
      lastVerifiedAt: now,
      createdAt: now,
      encrypted,
    };
    this.state.accounts.push(account);
    await this.sm.flush();
    return toInfo(account);
  }

  /** Checks the account against X (GET /2/users/me) and records its handle and status. */
  async verify(id: string): Promise<{ account: XAccountInfo; valid: boolean; message: string }> {
    const accountId = effectiveAccountId(id);
    // A revoked account is checked with its stored tokens: Verify brings it back once X accepts them.
    const creds =
      accountId === DEFAULT_ACCOUNT_ID
        ? this.credentials.getEffectiveCredentials()
        : this.tokenCredentials(this.getStored(accountId));
    const result = creds
      ? await verifyTwitterCredentials(creds)
      : { valid: false, message: 'Account tokens cannot be read (wrong encryption key?).' };
    const user = result.user as { username?: string; id?: string } | undefined;
    const patch = {
      status: result.valid ? ('ok' as const) : ('revoked' as const),
      lastVerifiedAt: new Date().toISOString(),
      lastError: result.valid ? undefined : result.message,
      ...(user?.username ? { handle: user.username } : {}),
      ...(user?.id ? { userId: user.id } : {}),
    };
    if (accountId === DEFAULT_ACCOUNT_ID) {
      this.state.defaultAccount = { ...this.state.defaultAccount, ...patch };
    } else {
      Object.assign(this.getStored(accountId), patch);
    }
    this.sm.persist();
    return { account: this.get(accountId)!, valid: result.valid, message: result.message };
  }

  rename(id: string, label: string): XAccountInfo {
    if (effectiveAccountId(id) === DEFAULT_ACCOUNT_ID) {
      throw new HttpError(400, 'The default account cannot be renamed.');
    }
    const clean = label.trim().slice(0, 60);
    if (!clean) throw new HttpError(400, 'label must not be empty');
    const account = this.getStored(id);
    account.label = clean;
    this.sm.persist();
    return toInfo(account);
  }

  /** Removes an account; campaigns posting as it are paused (they keep `accountId`). */
  remove(id: string): { pausedCampaigns: string[] } {
    if (effectiveAccountId(id) === DEFAULT_ACCOUNT_ID) {
      throw new HttpError(400, 'The default account cannot be removed.');
    }
    const account = this.getStored(id);
    this.state.accounts = this.state.accounts.filter((a) => a.id !== id);
    if (this.state.accountCooldowns) delete this.state.accountCooldowns[id];
    if (this.state.lastLivePostByAccount) delete this.state.lastLivePostByAccount[id];
    const pausedCampaigns = this.pauseCampaignsOf(id, accountPauseReason(account.handle));
    this.sm.persist();
    return { pausedCampaigns };
  }

  /** X answered 401 for this account: mark it revoked so campaigns stop using it until verified. */
  markRevoked(id: string | undefined, message?: string) {
    const accountId = effectiveAccountId(id);
    const patch = { status: 'revoked' as const, lastError: message?.slice(0, 300) };
    if (accountId === DEFAULT_ACCOUNT_ID) {
      this.state.defaultAccount = { ...this.state.defaultAccount, ...patch };
    } else {
      const account = this.state.accounts.find((a) => a.id === accountId);
      if (!account) return;
      Object.assign(account, patch);
    }
    this.sm.persist();
  }

  private pauseCampaignsOf(id: string, reason: string): string[] {
    const paused: string[] = [];
    for (const ctx of this.state.contexts) {
      if (ctx.accountId !== id) continue;
      paused.push(ctx.name);
      if (!ctx.enabled) {
        ctx.autoPausedReason = ctx.autoPausedReason || reason;
        continue;
      }
      ctx.enabled = false;
      ctx.autoPausedReason = reason;
      ctx.pendingFire = undefined;
      console.warn(`[Accounts] Paused "${ctx.name}": ${reason}`);
    }
    return paused;
  }
}
