/**
 * End-to-end server tests for multi-account posting against a fake X (tests/helpers/fakeX.ts):
 * the real twitterClient signs every request and the fake verifies each OAuth 1.0a signature.
 */

import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../server/app.js';
import { scheduler } from '../../server/scheduler.js';
import { PENDING_OAUTH_TTL_MS } from '../../server/services/accountService.js';
import { createDropService, dropService } from '../../server/services/dropService.js';
import { resolveTemplateText } from '../../server/templateAgent.js';
import { postColorTweet } from '../../server/twitterClient.js';
import { createServices, services, type Services } from '../../server/services/index.js';
import { MemoryStore } from '../../server/store/MemoryStore.js';
import { FakeX, type FakeUser } from '../helpers/fakeX.js';

const TARGET = '1700000000000000001';
const CALLBACK = 'http://localhost/oauth/x/callback';
const KEY = 'd'.repeat(64);
const MIN = 60_000;

let fake: FakeX;
let now = Date.UTC(2026, 9, 5, 12, 0, 0);
/** Every response body and console line, grepped for secrets by the security test. */
let transcript: string[] = [];

type App = ReturnType<typeof createApp>;
/** The app over `svc`, with a drop service that posts through the real X client (to the fake). */
const appFor = (svc: Services): App =>
  createApp({
    services: svc,
    scheduler,
    drops:
      svc === services
        ? dropService
        : createDropService({ services: svc, postColorTweet, resolveTemplateText }),
    authDisabled: true,
  });

const record = <T extends { body: unknown }>(res: T): T => {
  transcript.push(JSON.stringify(res.body));
  return res;
};

/** Runs connect start -> X authorize page -> complete, the way the UI does it. */
const connectViaApi = async (app: App, user: FakeUser, mode: 'redirect' | 'pin') => {
  const start = record(
    await request(app)
      .post('/api/accounts/connect/start')
      .set('Host', 'localhost')
      .send(mode === 'pin' ? { mode: 'pin' } : { callbackUrl: CALLBACK }),
  );
  expect(start.status).toBe(200);
  const authorize = new URL(start.body.authorizeUrl);
  expect(`${authorize.origin}${authorize.pathname}`).toBe('https://api.x.com/oauth/authorize');
  expect(authorize.searchParams.get('force_login')).toBe('true');
  const oauthToken = authorize.searchParams.get('oauth_token')!;

  const { verifier, redirect } = fake.authorize(oauthToken, user.userId);
  let body: { oauthToken: string; verifier: string };
  if (mode === 'redirect') {
    // X sends the browser to <site>/oauth/x/callback?oauth_token=..&oauth_verifier=..
    const back = new URL(redirect!);
    expect(back.pathname).toBe('/oauth/x/callback');
    body = {
      oauthToken: back.searchParams.get('oauth_token')!,
      verifier: back.searchParams.get('oauth_verifier')!,
    };
  } else {
    expect(redirect).toBeUndefined();
    body = { oauthToken, verifier }; // the PIN the owner types in
  }
  return record(await request(app).post('/api/accounts/connect/complete').send(body));
};

beforeEach(() => {
  fake = new FakeX().install();
  transcript = [];
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  vi.stubEnv('TWITTER_API_KEY', fake.consumerKey);
  vi.stubEnv('TWITTER_API_SECRET', fake.consumerSecret);
  vi.stubEnv('TWITTER_ACCESS_TOKEN', '');
  vi.stubEnv('TWITTER_ACCESS_TOKEN_SECRET', '');
  vi.stubEnv('GEMINI_API_KEY', '');
  vi.stubEnv('CREDENTIALS_ENCRYPTION_KEY', KEY);
  const capture =
    (orig: (...a: unknown[]) => void) =>
    (...args: unknown[]) => {
      transcript.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
      void orig;
    };
  for (const level of ['log', 'warn', 'error', 'info'] as const) {
    vi.spyOn(console, level).mockImplementation(capture(console[level]));
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('connect flow against the fake X', () => {
  it('redirect mode: start, authorize URL, callback, complete', async () => {
    const svc = await createServices(new MemoryStore());
    const app = appFor(svc);
    const user = fake.addUser('2001', 'brand_one');
    const done = await connectViaApi(app, user, 'redirect');
    expect(done.status).toBe(200);
    expect(done.body.account).toMatchObject({
      id: 'acct_2001',
      handle: 'brand_one',
      status: 'ok',
      isDefault: false,
    });
    expect(fake.requests.map((r) => [r.path, r.signatureValid])).toEqual([
      ['/oauth/request_token', true],
      ['/oauth/access_token', true],
    ]);
    expect(fake.requests[0].token).toBe(''); // request_token is signed with the consumer only
    expect(svc.accounts.getCredentialsForAccount('acct_2001')).toMatchObject({
      accessToken: user.accessToken,
      accessTokenSecret: user.accessTokenSecret,
    });
  });

  it('PIN mode: oob callback and the typed PIN', async () => {
    const svc = await createServices(new MemoryStore());
    const user = fake.addUser('2002', 'brand_two');
    const done = await connectViaApi(appFor(svc), user, 'pin');
    expect(done.body.account).toMatchObject({ id: 'acct_2002', handle: 'brand_two' });

    // Verify goes to GET /2/users/me signed with this account's own token.
    const verified = record(await request(appFor(svc)).post('/api/accounts/acct_2002/verify'));
    expect(verified.body).toMatchObject({ valid: true, account: { status: 'ok' } });
    const me = fake.requests.at(-1)!;
    expect(me).toMatchObject({
      path: '/2/users/me',
      token: user.accessToken,
      signatureValid: true,
    });
  });
});

describe('failure paths', () => {
  let svc: Services;
  let app: App;

  beforeEach(async () => {
    svc = await createServices(new MemoryStore());
    app = appFor(svc);
  });

  it('an unknown or expired request token is refused before reaching X', async () => {
    const unknown = await request(app)
      .post('/api/accounts/connect/complete')
      .send({ oauthToken: 'never-issued', verifier: '1' });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error).toMatch(/expired or was already used/);

    const start = await request(app).post('/api/accounts/connect/start').send({ mode: 'pin' });
    const token = new URL(start.body.authorizeUrl).searchParams.get('oauth_token')!;
    const { verifier } = fake.authorize(token, fake.addUser('2003', 'late').userId);
    now += PENDING_OAUTH_TTL_MS + 1;
    const late = await request(app)
      .post('/api/accounts/connect/complete')
      .send({ oauthToken: token, verifier });
    expect(late.status).toBe(400);
    expect(late.body.error).toMatch(/expired/);
    expect(fake.requests.filter((r) => r.path === '/oauth/access_token')).toHaveLength(0);
  });

  it('a wrong PIN is a 400 and adds no account', async () => {
    const start = await request(app).post('/api/accounts/connect/start').send({ mode: 'pin' });
    const token = new URL(start.body.authorizeUrl).searchParams.get('oauth_token')!;
    fake.authorize(token, fake.addUser('2004', 'typo').userId);
    const res = await request(app)
      .post('/api/accounts/connect/complete')
      .send({ oauthToken: token, verifier: '0000000' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid or expired token/);
    expect(svc.accounts.list()).toHaveLength(1);
  });

  it('a 401 on post revokes the account and auto-pauses its campaign', async () => {
    const user = fake.addUser('2005', 'gone_bad');
    await connectViaApi(app, user, 'pin');
    svc.settings.updateSettings({ globalDryRun: false, globalPaused: false });
    const ctx = svc.contexts.createContext({
      name: 'bad',
      targetTweetId: TARGET,
      accountId: 'acct_2005',
      enabled: true,
      template: 'hello {color_pick}',
    });
    user.revoked = true; // the owner revoked the app on x.com
    const out = record(
      await request(app).post(`/api/contexts/${ctx.id}/trigger`).send({ forceLive: false }),
    ).body;
    expect(out.success).toBe(false);
    expect(svc.accounts.get('acct_2005')?.status).toBe('revoked');
    expect(svc.contexts.getContext(ctx.id)).toMatchObject({ enabled: false });
    expect(svc.contexts.getContext(ctx.id)?.autoPausedReason).toMatch(/401/);
    const accounts = record(await request(app).get('/api/accounts'));
    expect(accounts.body.accounts[1]).toMatchObject({ status: 'revoked' });
  });

  it('removing an account used by two campaigns pauses both', async () => {
    await connectViaApi(app, fake.addUser('2006', 'shared'), 'redirect');
    const a = svc.contexts.createContext({ name: 'A', accountId: 'acct_2006', enabled: true });
    const b = svc.contexts.createContext({ name: 'B', accountId: 'acct_2006', enabled: true });
    const c = svc.contexts.createContext({ name: 'C', enabled: true });
    const res = record(await request(app).delete('/api/accounts/acct_2006'));
    expect(res.body.pausedCampaigns).toEqual(['A', 'B']);
    for (const id of [a.id, b.id]) {
      expect(svc.contexts.getContext(id)).toMatchObject({
        enabled: false,
        accountId: 'acct_2006',
        autoPausedReason: 'Account @shared is removed or disconnected — pick an account and resume',
      });
    }
    expect(svc.contexts.getContext(c.id)?.enabled).toBe(true);
  });

  it('an undecryptable token blob fails the drop without calling X', async () => {
    await connectViaApi(app, fake.addUser('2007', 'lost_key'), 'pin');
    svc.settings.updateSettings({ globalDryRun: false, globalPaused: false });
    const ctx = svc.contexts.createContext({
      name: 'lost',
      targetTweetId: TARGET,
      accountId: 'acct_2007',
      enabled: true,
    });
    vi.stubEnv('CREDENTIALS_ENCRYPTION_KEY', 'e'.repeat(64)); // key rotated without reconnecting
    expect(svc.accounts.getCredentialsForAccount('acct_2007')).toBeNull();
    const before = fake.requests.length;
    const trigger = record(
      await request(app).post(`/api/contexts/${ctx.id}/trigger`).send({ forceLive: true }),
    );
    expect(trigger.body.success).toBe(false);
    expect(trigger.body.log.errorMessage).toMatch(/tokens cannot be read/);
    expect(fake.requests.length).toBe(before);
    expect(svc.contexts.getContext(ctx.id)?.enabled).toBe(false);
    // The list still works (no tokens are needed to describe an account).
    expect((await request(app).get('/api/accounts')).body.accounts).toHaveLength(2);
  });
});

describe('scheduler: 3 campaigns on 3 accounts', () => {
  it('signs each post with its own account, keeps chains per account, isolates cooldown and spacing', async () => {
    const app = appFor(services);
    const users = [
      fake.addUser('3001', 'acct_alpha'),
      fake.addUser('3002', 'acct_bravo'),
      fake.addUser('3003', 'acct_charlie'),
    ];
    await connectViaApi(app, users[0], 'redirect');
    await connectViaApi(app, users[1], 'pin');
    await connectViaApi(app, users[2], 'redirect');
    services.settings.updateSettings({ globalDryRun: false, globalPaused: false });
    services.rateLimit.clearCooldown();
    for (const c of services.contexts.getContexts()) c.enabled = false;

    const make = (name: string, accountId: string, extra = {}) =>
      services.contexts.createContext({
        name,
        accountId,
        targetTweetId: TARGET,
        enabled: true,
        dryRun: false,
        template: `${name} {color_pick}`,
        hashtags: [],
        schedule: { mode: 'interval', intervalMinutes: 60, humanizeJitterEnabled: false },
        ...extra,
      }).id;
    const A = make('A', 'acct_3001');
    const B = make('B', 'acct_3002', { replyTargetMode: 'last_comment' }); // chain mode
    const C = make('C', 'acct_3003', { engagementMode: 'quote' });
    const ctx = (id: string) => services.contexts.getContext(id)!;
    const makeDue = (...ids: string[]) => {
      for (const id of ids) services.contexts.setContextLastPostedTimestamp(id, now - 61 * MIN);
    };
    const tweetsOf = (u: FakeUser) => fake.tweetsBy(u.userId);

    // Tick 1: all three post, each signed with its own account's token.
    makeDue(A, B, C);
    await scheduler.tick();
    expect(fake.tweets).toHaveLength(3);
    for (const u of users) {
      expect(tweetsOf(u)).toHaveLength(1);
      expect(tweetsOf(u)[0].token).toBe(u.accessToken);
    }
    expect(fake.requests.every((r) => r.signatureValid)).toBe(true);
    expect(tweetsOf(users[1])[0].inReplyTo).toBe(TARGET); // chain starts at the root
    expect(tweetsOf(users[2])[0].quoteOf).toBe(TARGET);
    const firstChainTweet = tweetsOf(users[1])[0].id;
    expect(ctx(B).chainAnchor?.tweetId).toBe(firstChainTweet);

    // Tick 2 (60 s later): A hits a 429; B continues ITS chain; C posts. A's cooldown is A's alone.
    now += MIN;
    fake.failNextPost('3001', 429, { title: 'Too Many Requests', status: 429 });
    makeDue(A, B, C);
    await scheduler.tick();
    expect(services.rateLimit.getCooldownState('acct_3001').isThrottled).toBe(true);
    expect(services.rateLimit.getCooldownState('acct_3002').isThrottled).toBe(false);
    expect(tweetsOf(users[1])).toHaveLength(2);
    expect(tweetsOf(users[1])[1].inReplyTo).toBe(firstChainTweet); // replies to its own tweet
    expect(tweetsOf(users[2])).toHaveLength(2);
    expect(tweetsOf(users[0])).toHaveLength(1);

    // Tick 3 (60 s later): A still cooling down, B and C post.
    now += MIN;
    makeDue(A, B, C);
    await scheduler.tick();
    expect(tweetsOf(users[0])).toHaveLength(1);
    expect(tweetsOf(users[1])).toHaveLength(3);
    expect(tweetsOf(users[2])).toHaveLength(3);
    expect(scheduler.getBlockedReason(ctx(A))).toMatch(/X cooldown for @acct_alpha/);

    // Tick 4 (10 s later): B and C are inside their own 50 s spacing; A's cooldown is cleared and
    // its last LIVE post was minutes ago, so only A posts.
    now += 10_000;
    services.rateLimit.clearCooldown('acct_3001');
    makeDue(A, B, C);
    await scheduler.tick();
    expect(tweetsOf(users[0])).toHaveLength(2);
    expect(tweetsOf(users[1])).toHaveLength(3);
    expect(tweetsOf(users[2])).toHaveLength(3);

    // Every chain reply was written by the same account that wrote the tweet it replies to.
    const byId = new Map(fake.tweets.map((t) => [t.id, t]));
    for (const t of fake.tweets) {
      const parent = t.inReplyTo ? byId.get(t.inReplyTo) : undefined;
      if (parent) expect(parent.authorId).toBe(t.authorId);
    }
    expect(fake.tweets.every((t) => t.token === fake.users.get(t.authorId)!.accessToken)).toBe(
      true,
    );

    // Logs and status name the account.
    const status = record(await request(app).get('/api/status'));
    expect(status.body.accountCooldowns['acct_3001'].isThrottled).toBe(false);
    const logs = record(await request(app).get('/api/history'));
    const handles = new Set(
      (logs.body.logs as { accountHandle?: string }[]).map((l) => l.accountHandle),
    );
    expect([...handles]).toEqual(
      expect.arrayContaining(['acct_alpha', 'acct_bravo', 'acct_charlie']),
    );

    // Security: no response body and no console line contains a token or secret.
    const all = transcript.join('\n');
    expect(all.length).toBeGreaterThan(1000);
    for (const secret of fake.secrets()) expect(all).not.toContain(secret);
  });
});

describe('security', () => {
  it('no API response or log line contains a token or secret across the account lifecycle', async () => {
    const svc = await createServices(new MemoryStore());
    const app = appFor(svc);
    const u1 = fake.addUser('4001', 'sec_one');
    const u2 = fake.addUser('4002', 'sec_two');
    await connectViaApi(app, u1, 'redirect');
    await connectViaApi(app, u2, 'pin');
    await connectViaApi(app, u1, 'pin'); // reconnect (token refresh)
    record(await request(app).get('/api/accounts'));
    record(await request(app).get('/api/status'));
    record(await request(app).post('/api/accounts/acct_4001/verify'));
    record(await request(app).patch('/api/accounts/acct_4002').send({ label: 'Second' }));
    svc.settings.updateSettings({ globalDryRun: false, globalPaused: false });
    const ctx = svc.contexts.createContext({
      name: 'sec',
      targetTweetId: TARGET,
      accountId: 'acct_4001',
      template: 'sec {color_pick}',
    });
    record(await request(app).post(`/api/contexts/${ctx.id}/trigger`).send({ forceLive: true }));
    fake.failNextPost('4001', 401, { title: 'Unauthorized' });
    record(await request(app).post(`/api/contexts/${ctx.id}/trigger`).send({ forceLive: true }));
    record(await request(app).post('/api/twitter/verify'));
    record(await request(app).get('/api/contexts'));
    record(await request(app).delete('/api/accounts/acct_4002'));
    record(await request(app).get('/api/history'));

    const all = transcript.join('\n');
    expect(fake.tweets.length).toBeGreaterThan(0);
    for (const secret of fake.secrets()) expect(all).not.toContain(secret);
    expect(all).not.toContain('enc:v1:');
    expect(all).not.toContain('"encrypted"');
  });
});
