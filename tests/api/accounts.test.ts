import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../server/app.js';
import { scheduler } from '../../server/scheduler.js';
import { PENDING_OAUTH_TTL_MS } from '../../server/services/accountService.js';
import { dropService } from '../../server/services/dropService.js';
import { createServices, type Services } from '../../server/services/index.js';
import { MemoryStore } from '../../server/store/MemoryStore.js';
import {
  oauth1AccessToken,
  oauth1RequestToken,
  verifyTwitterCredentials,
} from '../../server/twitterClient.js';

vi.mock('../../server/twitterClient.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../server/twitterClient.js')>()),
  oauth1RequestToken: vi.fn(),
  oauth1AccessToken: vi.fn(),
  verifyTwitterCredentials: vi.fn(),
  postColorTweet: vi.fn(async () => {
    throw new Error('X must not be called from account route tests');
  }),
}));

const KEY = 'b'.repeat(64);
const CALLBACK = 'http://localhost/oauth/x/callback';
let svc: Services;
let app: ReturnType<typeof createApp>;
let tokenCounter = 0;

const requestToken = vi.mocked(oauth1RequestToken);
const accessToken = vi.mocked(oauth1AccessToken);
const verify = vi.mocked(verifyTwitterCredentials);

/** Runs the whole redirect flow for one X user. */
const connect = async (userId: string, screenName: string, secret = `secret-${userId}`) => {
  const token = `req-${++tokenCounter}`;
  requestToken.mockResolvedValueOnce({
    oauthToken: token,
    oauthTokenSecret: 'req-secret',
    callbackConfirmed: true,
  });
  accessToken.mockResolvedValueOnce({
    accessToken: `token-${userId}`,
    accessTokenSecret: secret,
    userId,
    screenName,
  });
  const start = await request(app)
    .post('/api/accounts/connect/start')
    .set('Host', 'localhost')
    .send({ callbackUrl: CALLBACK });
  expect(start.status).toBe(200);
  return request(app)
    .post('/api/accounts/connect/complete')
    .send({ oauthToken: token, verifier: 'v123' });
};

beforeEach(async () => {
  vi.stubEnv('TWITTER_API_KEY', 'consumer-key');
  vi.stubEnv('TWITTER_API_SECRET', 'consumer-secret');
  vi.stubEnv('TWITTER_ACCESS_TOKEN', 'env-token');
  vi.stubEnv('TWITTER_ACCESS_TOKEN_SECRET', 'env-secret');
  vi.stubEnv('CREDENTIALS_ENCRYPTION_KEY', KEY);
  svc = await createServices(new MemoryStore());
  app = createApp({ services: svc, scheduler, drops: dropService, authDisabled: true });
  requestToken.mockReset();
  accessToken.mockReset();
  verify.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('GET /api/accounts', () => {
  it('lists the default account first and never leaks tokens', async () => {
    await connect('222', 'second_acct');
    const res = await request(app).get('/api/accounts');
    expect(res.status).toBe(200);
    expect(res.body.accounts.map((a: { id: string }) => a.id)).toEqual(['acct_env', 'acct_222']);
    expect(res.body.accounts[0]).toMatchObject({ isDefault: true, label: 'Default account' });
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('secret-222');
    expect(raw).not.toContain('token-222');
    expect(raw).not.toContain('encrypted');
    const status = await request(app).get('/api/status');
    expect(JSON.stringify(status.body)).not.toContain('secret-222');
  });

  it('stores tokens encrypted (round-trip through getCredentialsForAccount)', async () => {
    const store = new MemoryStore();
    svc = await createServices(store);
    app = createApp({ services: svc, scheduler, drops: dropService, authDisabled: true });
    await connect('222', 'second_acct');
    await svc.flush();
    const persisted = JSON.stringify(await store.load());
    expect(persisted).toContain('enc:v1:');
    expect(persisted).not.toContain('secret-222');
    expect(persisted).not.toContain('token-222');
    expect(svc.accounts.getCredentialsForAccount('acct_222')).toEqual({
      apiKey: 'consumer-key',
      apiSecret: 'consumer-secret',
      accessToken: 'token-222',
      accessTokenSecret: 'secret-222',
    });
    // Default account = the env credentials.
    expect(svc.accounts.getCredentialsForAccount(undefined)).toMatchObject({
      accessToken: 'env-token',
    });
    expect(svc.accounts.getCredentialsForAccount('acct_missing')).toBeNull();
  });
});

describe('connect flow', () => {
  it('redirect mode passes the validated callback; PIN mode uses oob', async () => {
    requestToken.mockResolvedValue({
      oauthToken: 'tok',
      oauthTokenSecret: 's',
      callbackConfirmed: true,
    });
    const redirect = await request(app)
      .post('/api/accounts/connect/start')
      .set('Host', 'localhost')
      .send({ callbackUrl: CALLBACK });
    expect(redirect.body).toMatchObject({
      success: true,
      mode: 'redirect',
      authorizeUrl: 'https://api.x.com/oauth/authorize?oauth_token=tok&force_login=true',
    });
    expect(requestToken.mock.calls[0][1]).toBe(CALLBACK);
    expect(JSON.stringify(redirect.body)).not.toContain('"s"');

    const pin = await request(app).post('/api/accounts/connect/start').send({ mode: 'pin' });
    expect(pin.body.mode).toBe('pin');
    expect(requestToken.mock.calls[1][1]).toBe('oob');
  });

  it.each([
    'https://evil.example/oauth/x/callback',
    'http://localhost/elsewhere',
    'http://localhost/oauth/x/callback?next=https://evil.example',
    'javascript:alert(1)',
    undefined,
  ])('rejects callback %s', async (callbackUrl) => {
    const res = await request(app)
      .post('/api/accounts/connect/start')
      .set('Host', 'localhost')
      .send({ callbackUrl });
    expect(res.status).toBe(400);
    expect(requestToken).not.toHaveBeenCalled();
  });

  it('rejects plain http for a non-local host, but accepts an allow-listed origin', async () => {
    requestToken.mockResolvedValue({
      oauthToken: 't',
      oauthTokenSecret: 's',
      callbackConfirmed: true,
    });
    const insecure = await request(app)
      .post('/api/accounts/connect/start')
      .set('Host', 'bot.example')
      .send({ callbackUrl: 'http://bot.example/oauth/x/callback' });
    expect(insecure.status).toBe(400);
    const sameHost = await request(app)
      .post('/api/accounts/connect/start')
      .set('Host', 'bot.example')
      .send({ callbackUrl: 'https://bot.example/oauth/x/callback' });
    expect(sameHost.status).toBe(200);
    vi.stubEnv('OAUTH_CALLBACK_ORIGINS', 'https://colors.example');
    const listed = await request(app)
      .post('/api/accounts/connect/start')
      .set('Host', 'internal.run.app')
      .send({ callbackUrl: 'https://colors.example/oauth/x/callback' });
    expect(listed.status).toBe(200);
  });

  it('persists the pending request token encrypted (survives a new instance)', async () => {
    const store = new MemoryStore();
    svc = await createServices(store);
    app = createApp({ services: svc, scheduler, drops: dropService, authDisabled: true });
    requestToken.mockResolvedValue({
      oauthToken: 'tok-x',
      oauthTokenSecret: 'very-secret-request',
      callbackConfirmed: true,
    });
    await request(app).post('/api/accounts/connect/start').send({ mode: 'pin' });
    const saved = await store.load();
    expect(saved.pendingOAuth).toHaveLength(1);
    expect(JSON.stringify(saved)).not.toContain('very-secret-request');

    // A fresh instance over the same store completes the flow.
    const next = await createServices(store);
    const app2 = createApp({ services: next, scheduler, drops: dropService, authDisabled: true });
    accessToken.mockResolvedValue({
      accessToken: 'a',
      accessTokenSecret: 'b',
      userId: '333',
      screenName: 'third',
    });
    const done = await request(app2)
      .post('/api/accounts/connect/complete')
      .send({ oauthToken: 'tok-x', verifier: ' 1234567 ' });
    expect(done.status).toBe(200);
    expect(done.body.account).toMatchObject({ id: 'acct_333', handle: 'third', status: 'ok' });
    expect(accessToken.mock.calls[0].slice(1)).toEqual(['tok-x', 'very-secret-request', '1234567']);
  });

  it('expires pending request tokens after 10 minutes and refuses reuse', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    requestToken.mockResolvedValue({
      oauthToken: 'old',
      oauthTokenSecret: 's',
      callbackConfirmed: true,
    });
    await request(app).post('/api/accounts/connect/start').send({ mode: 'pin' });
    vi.setSystemTime(Date.now() + PENDING_OAUTH_TTL_MS + 1000);
    const late = await request(app)
      .post('/api/accounts/connect/complete')
      .send({ oauthToken: 'old', verifier: '1' });
    expect(late.status).toBe(400);
    expect(late.body.error).toMatch(/expired/);
    expect(accessToken).not.toHaveBeenCalled();
  });

  it('reconnecting the same X user updates its tokens instead of duplicating it', async () => {
    await connect('222', 'second_acct', 'first-secret');
    await svc.accounts.rename('acct_222', 'Brand');
    const again = await connect('222', 'second_renamed', 'second-secret');
    expect(again.status).toBe(200);
    expect(svc.accounts.list()).toHaveLength(2);
    expect(svc.accounts.get('acct_222')).toMatchObject({
      label: 'Brand',
      handle: 'second_renamed',
    });
    expect(svc.accounts.getCredentialsForAccount('acct_222')?.accessTokenSecret).toBe(
      'second-secret',
    );
  });

  it('answers 400 with a clear message when CREDENTIALS_ENCRYPTION_KEY is missing', async () => {
    vi.stubEnv('CREDENTIALS_ENCRYPTION_KEY', '');
    const res = await request(app).post('/api/accounts/connect/start').send({ mode: 'pin' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/CREDENTIALS_ENCRYPTION_KEY/);
    expect(requestToken).not.toHaveBeenCalled();
  });

  it('turns an X refusal of the verifier into a 400', async () => {
    requestToken.mockResolvedValue({
      oauthToken: 'tok',
      oauthTokenSecret: 's',
      callbackConfirmed: true,
    });
    accessToken.mockRejectedValue(new Error('X refused the access-token step (HTTP 401): bad PIN'));
    await request(app).post('/api/accounts/connect/start').send({ mode: 'pin' });
    const res = await request(app)
      .post('/api/accounts/connect/complete')
      .send({ oauthToken: 'tok', verifier: '0' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/bad PIN/);
  });
});

describe('verify, rename, remove', () => {
  it('verify records the handle and status (and revokes on failure)', async () => {
    verify.mockResolvedValueOnce({
      valid: true,
      user: { username: 'owner', id: '111' },
      message: 'ok',
    });
    const ok = await request(app).post('/api/accounts/acct_env/verify');
    expect(ok.body.account).toMatchObject({ id: 'acct_env', handle: 'owner', status: 'ok' });

    await connect('222', 'second_acct');
    verify.mockResolvedValueOnce({ valid: false, message: 'Unauthorized' });
    const bad = await request(app).post('/api/accounts/acct_222/verify');
    expect(bad.body).toMatchObject({ valid: false, account: { status: 'revoked' } });
    expect(svc.accounts.getCredentialsForAccount('acct_222')).toBeNull();

    // Verify uses the stored tokens even while revoked, so it can bring the account back.
    verify.mockResolvedValueOnce({ valid: true, user: { username: 'second_acct' }, message: 'ok' });
    await request(app).post('/api/accounts/acct_222/verify');
    expect(verify.mock.calls[2][0]).toMatchObject({ accessToken: 'token-222' });
    expect(svc.accounts.get('acct_222')?.status).toBe('ok');
  });

  it('renames connected accounts only', async () => {
    await connect('222', 'second_acct');
    const res = await request(app).patch('/api/accounts/acct_222').send({ label: '  Shop  ' });
    expect(res.body.account.label).toBe('Shop');
    expect((await request(app).patch('/api/accounts/acct_env').send({ label: 'x' })).status).toBe(
      400,
    );
    expect((await request(app).patch('/api/accounts/nope').send({ label: 'x' })).status).toBe(404);
  });

  it('removing an account pauses its campaigns (they keep accountId); default is not removable', async () => {
    await connect('222', 'second_acct');
    const a = svc.contexts.createContext({ name: 'A', accountId: 'acct_222', enabled: true });
    const b = svc.contexts.createContext({ name: 'B', enabled: true });
    const res = await request(app).delete('/api/accounts/acct_222');
    expect(res.body.pausedCampaigns).toEqual(['A']);
    expect(svc.contexts.getContext(a.id)).toMatchObject({
      enabled: false,
      accountId: 'acct_222',
      autoPausedReason: expect.stringMatching(/@second_acct is removed or disconnected/),
    });
    expect(svc.contexts.getContext(b.id)?.enabled).toBe(true);
    expect((await request(app).delete('/api/accounts/acct_env')).status).toBe(400);

    // Resuming a campaign whose account is gone is refused.
    const resume = await request(app).post(`/api/contexts/${a.id}/toggle`);
    expect(resume.status).toBe(400);
    expect(resume.body.error).toMatch(/removed or disconnected/);
  });
});

describe('campaign accountId', () => {
  it('rejects an unknown account on create and update (400)', async () => {
    const created = await request(app)
      .post('/api/contexts')
      .send({ name: 'X', targetTweetId: '1700000000000000001', accountId: 'acct_nope' });
    expect(created.status).toBe(400);
    expect(created.body.error).toMatch(/Unknown X account/);

    const id = svc.contexts.getContexts()[0].id;
    const updated = await request(app).put(`/api/contexts/${id}`).send({ accountId: 'acct_nope' });
    expect(updated.status).toBe(400);
  });

  it('stores the default account as undefined and keeps a valid one', async () => {
    await connect('222', 'second_acct');
    const res = await request(app)
      .post('/api/contexts')
      .send({ name: 'Y', targetTweetId: '1700000000000000001', accountId: 'acct_222' });
    expect(res.body.context.accountId).toBe('acct_222');
    const back = await request(app)
      .put(`/api/contexts/${res.body.context.id}`)
      .send({ accountId: 'acct_env' });
    expect(back.body.context.accountId).toBeUndefined();
  });

  it('changing the account resets the reply chain like a target change', async () => {
    await connect('222', 'second_acct');
    const ctx = svc.contexts.createContext({
      name: 'chain',
      targetTweetId: '1000',
      replyTargetMode: 'last_comment',
    });
    svc.contexts.recordContextPostResult(ctx.id, 'success', '5555', 'reply');
    expect(svc.contexts.getContext(ctx.id)?.chainAnchor?.tweetId).toBe('5555');

    // Same account (default spelled two ways) and other edits keep the chain.
    await request(app).put(`/api/contexts/${ctx.id}`).send({ accountId: '', name: 'renamed' });
    expect(svc.contexts.getContext(ctx.id)?.chainAnchor?.tweetId).toBe('5555');

    await request(app).put(`/api/contexts/${ctx.id}`).send({ accountId: 'acct_222' });
    expect(svc.contexts.getContext(ctx.id)).toMatchObject({
      accountId: 'acct_222',
      chainAnchor: undefined,
      lastPostedTweetId: undefined,
    });
  });

  it('duplicate copies the account', async () => {
    await connect('222', 'second_acct');
    const ctx = svc.contexts.createContext({ name: 'orig', accountId: 'acct_222' });
    expect(svc.contexts.duplicateContext(ctx.id).accountId).toBe('acct_222');
  });
});
