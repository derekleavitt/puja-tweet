/**
 * X accounts campaigns can post as: the CONNECTED accounts, from the OAuth 1.0a 3-legged flow (or
 * its PIN variant) in Settings → X accounts. There is no built-in default account. Only their user
 * access token + secret differ; the consumer key/secret stay app-level. Tokens are stored
 * encrypted with CREDENTIALS_ENCRYPTION_KEY and never leave the server.
 */

import { summarizeWipeJob } from './wipeJob.js';
import { HttpError } from '../middleware/error.js';
import {
  oauth1AccessToken,
  oauth1AuthorizeUrl,
  OAUTH_AUTHORIZE_URL_ALT,
  oauth1RequestToken,
  verifyTwitterCredentials,
  type TwitterCredentials,
} from '../twitterClient.js';
import type { XAccountInfo } from '../../shared/types.js';
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

/** Reason a campaign without an account cannot post. */
export const NO_ACCOUNT_REASON =
  'No X account selected: connect one in Settings → X accounts and pick it in the campaign form';

/** Why campaigns cannot post as this account (none, unknown or revoked); undefined when usable. */
export const accountProblem = (state: BotState, id?: string | null): string | undefined => {
  if (!id) return NO_ACCOUNT_REASON;
  const account = state.accounts.find((a) => a.id === id);
  if (!account || account.status === 'revoked') return accountPauseReason(account?.handle);
  return undefined;
};

/** Reason used when a campaign is paused because its account went away. */
export const accountPauseReason = (handle?: string) =>
  `${handle ? `Account @${handle}` : "This campaign's X account"} is removed or disconnected — pick an account and resume`;

const toInfo = (a: XAccount): XAccountInfo => ({
  id: a.id,
  label: a.label,
  handle: a.handle,
  userId: a.userId,
  status: a.status,
  lastVerifiedAt: a.lastVerifiedAt,
  lastError: a.lastError,
  createdAt: a.createdAt,
});

export class AccountService {
  constructor(
    private readonly sm: StateManager,
    private readonly credentials: CredentialService,
  ) {}

  private get state() {
    return this.sm.state;
  }

  /** Every connected account, with its latest content-wipe progress. Never includes tokens. */
  list(): XAccountInfo[] {
    return this.state.accounts.map(toInfo).map((info) => {
      const wipe = summarizeWipeJob(this.state.wipeJobs?.[info.id]);
      return wipe ? { ...info, wipe } : info;
    });
  }

  get(id?: string | null): XAccountInfo | undefined {
    const found = id ? this.state.accounts.find((a) => a.id === id) : undefined;
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

  /** Why campaigns cannot post as this account right now; undefined when usable. */
  problem(id?: string | null): string | undefined {
    const known = accountProblem(this.state, id);
    if (known || this.getCredentialsForAccount(id)) return known;
    const handle = this.handleOf(id);
    return `${handle ? `Account @${handle}` : "This campaign's X account"} cannot be used: its tokens cannot be read (CREDENTIALS_ENCRYPTION_KEY changed?) or the app API key is missing — reconnect the account and resume`;
  }

  handleOf(id?: string | null): string | undefined {
    return this.get(id)?.handle || undefined;
  }

  /**
   * Full credentials to post as this account, or null when there is none, it is unknown or
   * revoked, or its tokens cannot be decrypted (or the app has no consumer key).
   */
  getCredentialsForAccount(id?: string | null): TwitterCredentials | null {
    const account = id ? this.state.accounts.find((a) => a.id === id) : undefined;
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
  async startConnect(
    callback: string,
  ): Promise<{ authorizeUrl: string; altAuthorizeUrl: string; oauthToken: string }> {
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
    return {
      authorizeUrl: oauth1AuthorizeUrl(token.oauthToken),
      altAuthorizeUrl: oauth1AuthorizeUrl(token.oauthToken, OAUTH_AUTHORIZE_URL_ALT),
      oauthToken: token.oauthToken,
    };
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

    return this.storeConnected(result, key);
  }

  /**
   * Stores (encrypted) the tokens X issued for a user. Reconnecting the same X user refreshes its
   * tokens instead of adding a duplicate. Used by the Connect flow (and by tests).
   */
  async storeConnected(
    result: { userId: string; screenName: string; accessToken: string; accessTokenSecret: string },
    key: Buffer = this.requireKey(),
  ): Promise<XAccountInfo> {
    const now = new Date().toISOString();
    const encrypted = encryptJson(
      { accessToken: result.accessToken, accessTokenSecret: result.accessTokenSecret },
      key,
    );
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
    const accountId = id;
    // A revoked account is checked with its stored tokens: Verify brings it back once X accepts them.
    const creds = this.tokenCredentials(this.getStored(accountId));
    const result = creds
      ? await verifyTwitterCredentials(creds)
      : {
          valid: false,
          message: 'Account tokens cannot be read (wrong encryption key?).',
          authRejected: true,
        };
    const user = result.user as { username?: string; id?: string } | undefined;
    // Only X rejecting the tokens revokes; a network error, 429 or 5xx keeps the current status.
    const current = this.get(accountId)?.status ?? 'unverified';
    const status = result.valid ? 'ok' : result.authRejected ? 'revoked' : current;
    const patch = {
      status,
      lastVerifiedAt: new Date().toISOString(),
      lastError: result.valid ? undefined : result.message,
      ...(user?.username ? { handle: user.username } : {}),
      ...(user?.id ? { userId: user.id } : {}),
    };
    Object.assign(this.getStored(accountId), patch);
    this.sm.persist();
    return { account: this.get(accountId)!, valid: result.valid, message: result.message };
  }

  rename(id: string, label: string): XAccountInfo {
    const clean = label.trim().slice(0, 60);
    if (!clean) throw new HttpError(400, 'label must not be empty');
    const account = this.getStored(id);
    account.label = clean;
    this.sm.persist();
    return toInfo(account);
  }

  /** Removes an account; campaigns posting as it are paused (they keep `accountId`). */
  remove(id: string): { pausedCampaigns: string[] } {
    const account = this.getStored(id);
    this.state.accounts = this.state.accounts.filter((a) => a.id !== id);
    if (this.state.accountCooldowns) delete this.state.accountCooldowns[id];
    if (this.state.lastLivePostByAccount) delete this.state.lastLivePostByAccount[id];
    if (this.state.wipeJobs) delete this.state.wipeJobs[id];
    const pausedCampaigns = this.pauseCampaignsOf(
      id,
      accountPauseReason(account.handle),
      `Participant ${account.handle ? `@${account.handle}` : 'account'} removed or disconnected — fix the cast and resume`,
    );
    this.sm.persist();
    return { pausedCampaigns };
  }

  /** A content wipe of this account is starting: its campaigns stop posting new content. */
  pauseCampaignsForWipe(id: string): string[] {
    const handle = this.handleOf(id);
    const who = handle ? `@${handle}` : 'this account';
    const reason = `Deleting all content of ${who} — resume when the wipe is done`;
    const paused = this.pauseCampaignsOf(id, reason, reason);
    this.sm.persist();
    return paused;
  }

  /** X answered 401 for this account: mark it revoked so campaigns stop using it until verified. */
  markRevoked(id: string | undefined, message?: string) {
    const account = id ? this.state.accounts.find((a) => a.id === id) : undefined;
    if (!account) return;
    Object.assign(account, { status: 'revoked' as const, lastError: message?.slice(0, 300) });
    this.sm.persist();
  }

  /** `participantReason` names a conversation campaign's own wording when `id` is in its cast. */
  private pauseCampaignsOf(id: string, singleReason: string, participantReason: string): string[] {
    const paused: string[] = [];
    for (const ctx of this.state.contexts) {
      const reason =
        ctx.mode === 'conversation'
          ? ctx.conversation?.participants.some((p) => p.accountId === id)
            ? participantReason
            : undefined
          : ctx.accountId === id
            ? singleReason
            : undefined;
      if (!reason) continue;
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
