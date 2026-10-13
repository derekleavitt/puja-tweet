/**
 * "Delete all content" of an X account (Settings → X accounts) against the fake X: posts deleted,
 * retweets undone, likes removed, across ticks and rate windows, with every request OAuth-signed
 * as the account itself.
 */

import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../server/app.js';
import { scheduler } from '../../server/scheduler.js';
import { createDropService } from '../../server/services/dropService.js';
import { createServices, type Services } from '../../server/services/index.js';
import { MemoryStore } from '../../server/store/MemoryStore.js';
import { resolveTemplateText } from '../../server/templateAgent.js';
import { postColorTweet } from '../../server/twitterClient.js';
import { estimateMinutesLeft } from '../../server/services/wipeJob.js';
import { CREDITS_RETRY_MS } from '../../server/services/wipeService.js';
import type { WipeJob } from '../../server/store/Store.js';
import { FakeX, type FakeUser } from '../helpers/fakeX.js';

const TARGET = '1700000000000000001';
const KEY = 'e'.repeat(64);
const ID = 'acct_2001';

let fake: FakeX;
let now = Date.UTC(2026, 9, 12, 12, 0, 0);
let svc: Services;
let app: ReturnType<typeof createApp>;
let user: FakeUser;
let other: FakeUser;

const connect = async (u: FakeUser) => {
  const start = await request(app).post('/api/accounts/connect/start').send({ mode: 'pin' });
  const oauthToken = new URL(start.body.authorizeUrl).searchParams.get('oauth_token')!;
  const { verifier } = fake.authorize(oauthToken, u.userId);
  const done = await request(app)
    .post('/api/accounts/connect/complete')
    .send({ oauthToken, verifier });
  expect(done.status).toBe(200);
};

const wipeOf = async () =>
  (await request(app).get('/api/accounts')).body.accounts.find((a: { id: string }) => a.id === ID)
    .wipe;

/** Ticks until the job stops running (or `max` ticks), a minute apart. */
const runTicks = async (max = 50) => {
  for (let i = 0; i < max; i++) {
    await svc.wipe.advance();
    if (svc.wipe.get(ID)?.status !== 'running') return i + 1;
    now += 60_000;
  }
  return max;
};

beforeEach(async () => {
  fake = new FakeX().install();
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  vi.stubEnv('TWITTER_API_KEY', fake.consumerKey);
  vi.stubEnv('TWITTER_API_SECRET', fake.consumerSecret);
  vi.stubEnv('TWITTER_ACCESS_TOKEN', '');
  vi.stubEnv('TWITTER_ACCESS_TOKEN_SECRET', '');
  vi.stubEnv('GEMINI_API_KEY', '');
  vi.stubEnv('CREDENTIALS_ENCRYPTION_KEY', KEY);
  for (const level of ['log', 'warn', 'error', 'info'] as const) {
    vi.spyOn(console, level).mockImplementation(() => {});
  }
  svc = await createServices(new MemoryStore());
  app = createApp({
    services: svc,
    scheduler,
    drops: createDropService({ services: svc, postColorTweet, resolveTemplateText }),
    authDisabled: true,
  });
  user = fake.addUser('2001', 'brand_one');
  other = fake.addUser('3001', 'someone_else');
  await connect(user);
  svc.settings.updateSettings({ globalDryRun: false });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('time left', () => {
  it('estimates from the slowest queued kind (about 50 per 15 minutes each)', () => {
    const job = {
      queue: [
        ...Array.from({ length: 120 }, (_, i) => ({ kind: 'post', id: String(i) })),
        ...Array.from({ length: 10 }, (_, i) => ({ kind: 'like', id: String(i) })),
      ],
      waitUntil: {},
    } as unknown as WipeJob;
    expect(estimateMinutesLeft(job, 0)).toBe(30); // 50 now, 50 after 15 min, 20 after 30 min
    job.waitUntil = { deletePost: 5 * 60_000 };
    expect(estimateMinutesLeft(job, 0)).toBe(35);
    expect(estimateMinutesLeft({ queue: [], waitUntil: {} } as unknown as WipeJob, 0)).toBe(0);
  });
});

describe('content wipe', () => {
  it('needs the @handle typed exactly, and a known account', async () => {
    let r = await request(app).post(`/api/accounts/${ID}/wipe`).send({ confirm: '@brand_two' });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('Type @brand_one to confirm');
    r = await request(app).post('/api/accounts/acct_nope/wipe').send({ confirm: 'x' });
    expect(r.status).toBe(404);
    expect(svc.wipe.get(ID)).toBeUndefined();
  });

  it('deletes posts, undoes retweets and removes likes, only the account’s own', async () => {
    const posts = Array.from({ length: 7 }, (_, i) => fake.seedPost(user.userId, `p${i}`));
    const theirs = fake.seedPost(other.userId, 'not ours');
    fake.seedRetweet(user.userId, theirs);
    fake.seedLike(user.userId, theirs);
    fake.seedLike(user.userId, posts[0]);
    fake.seedLike(other.userId, posts[1]);
    const campaign = svc.contexts.createContext({
      name: 'C',
      targetTweetId: TARGET,
      accountId: ID,
    });

    const r = await request(app).post(`/api/accounts/${ID}/wipe`).send({ confirm: 'Brand_One' });
    expect(r.status).toBe(200);
    expect(r.body.pausedCampaigns).toEqual(['C']);
    expect(svc.contexts.getContext(campaign.id)).toMatchObject({ enabled: false });
    expect(svc.contexts.getContext(campaign.id)?.autoPausedReason).toContain(
      'Deleting all content',
    );
    expect(await wipeOf()).toMatchObject({ status: 'running', simulate: false, phase: 'posts' });

    await runTicks();
    expect(fake.tweetsBy(user.userId)).toEqual([]);
    expect(fake.tweetsBy(other.userId).map((t) => t.id)).toEqual([theirs]);
    expect(fake.retweets.get(user.userId)).toEqual([]);
    expect(fake.likes.get(user.userId)).toEqual([]);
    expect(fake.likes.get(other.userId)).toEqual([posts[1]]);
    expect(await wipeOf()).toMatchObject({
      status: 'done',
      counts: { posts: 7, retweets: 1, likes: 2, failed: 0 },
    });
    // Every call was signed by the account itself, with a valid signature.
    const content = fake.requests.filter(
      (q) => q.path.startsWith('/2/') && q.path !== '/2/users/me',
    );
    expect(content.length).toBeGreaterThan(0);
    expect(content.every((q) => q.signatureValid && q.token === user.accessToken)).toBe(true);
  });

  it('repeats passes until older posts beyond the timeline cap are gone too', async () => {
    fake.timelineCap = 5;
    for (let i = 0; i < 12; i++) fake.seedPost(user.userId);
    await request(app).post(`/api/accounts/${ID}/wipe`).send({ confirm: 'brand_one' });
    await runTicks();
    expect(fake.tweetsBy(user.userId)).toEqual([]);
    expect(svc.wipe.get(ID)).toMatchObject({ status: 'done', counts: { posts: 12 } });
    expect(svc.wipe.get(ID)!.pass).toBe(1); // the likes phase starts its own pass count
  });

  it('waits for the rate window instead of hammering X', async () => {
    for (let i = 0; i < 5; i++) fake.seedPost(user.userId);
    const reset = Math.floor(now / 1000) + 15 * 60;
    fake.windows.set('deletePost', { remaining: 2, reset });
    await request(app).post(`/api/accounts/${ID}/wipe`).send({ confirm: 'brand_one' });
    await svc.wipe.advance();
    expect(fake.tweetsBy(user.userId)).toHaveLength(3);
    const summary = await wipeOf();
    expect(summary.waitingUntil).toBe(new Date(reset * 1000).toISOString());
    // 3 queued deletes go out as soon as the 15-minute wait ends.
    expect(summary).toMatchObject({ estimatedMinutesLeft: 15, moreToRead: true });
    expect(vi.mocked(console.log).mock.calls.flat().join('\n')).toMatch(
      /@brand_one: X rate limit for deletePost, waiting until /,
    );
    const callsBefore = fake.requests.length;
    now += 5 * 60_000;
    await svc.wipe.advance(); // still inside the window: no delete call at all
    expect(fake.requests.length).toBe(callsBefore);
    now = reset * 1000 + 1;
    fake.windows.delete('deletePost');
    await runTicks();
    expect(fake.tweetsBy(user.userId)).toEqual([]);
  });

  it('with the global dry run on, only counts and deletes nothing', async () => {
    svc.settings.updateSettings({ globalDryRun: true });
    for (let i = 0; i < 3; i++) fake.seedPost(user.userId);
    fake.seedLike(user.userId, fake.seedPost(other.userId));
    const campaign = svc.contexts.createContext({
      name: 'C',
      targetTweetId: TARGET,
      accountId: ID,
    });
    const r = await request(app).post(`/api/accounts/${ID}/wipe`).send({ confirm: 'brand_one' });
    expect(r.body.pausedCampaigns).toEqual([]);
    expect(svc.contexts.getContext(campaign.id)?.enabled).toBe(true);
    await runTicks();
    expect(fake.tweetsBy(user.userId)).toHaveLength(3);
    expect(fake.likes.get(user.userId)).toHaveLength(1);
    expect(await wipeOf()).toMatchObject({
      status: 'done',
      simulate: true,
      counts: { posts: 3, retweets: 0, likes: 1 },
    });
    expect(fake.requests.some((q) => q.method === 'DELETE')).toBe(false);
  });

  it('fails clearly when the X plan cannot read the timeline', async () => {
    fake.refuseReads = true;
    await request(app).post(`/api/accounts/${ID}/wipe`).send({ confirm: 'brand_one' });
    await runTicks();
    expect(await wipeOf()).toMatchObject({ status: 'failed' });
    expect((await wipeOf()).lastError).toContain('X plan may not include reading them');
    // The stop reason is in the server log, not only on the job.
    expect(vi.mocked(console.log).mock.calls.flat().join('\n')).toMatch(
      /@brand_one failed: .*Reason: X refused to list @brand_one's posts \(HTTP 403\)/,
    );
  });

  it('out of X API credits (402): skips nothing, waits, and continues where it stopped', async () => {
    for (let i = 0; i < 6; i++) fake.seedPost(user.userId);
    fake.windows.set('deletePost', { remaining: 2, reset: Math.floor(now / 1000) + 60 });
    await request(app).post(`/api/accounts/${ID}/wipe`).send({ confirm: 'brand_one' });
    await svc.wipe.advance(); // lists 6, deletes 2, then the window is used up
    expect(fake.tweetsBy(user.userId)).toHaveLength(4);

    fake.outOfCredits = true;
    fake.windows.delete('deletePost');
    now += 2 * 60_000;
    await svc.wipe.advance(); // first delete answers 402
    let summary = await wipeOf();
    expect(summary).toMatchObject({
      status: 'running',
      queued: 4,
      counts: { posts: 2, failed: 0 },
    });
    expect(summary.lastError).toContain('X API credits are used up (HTTP 402, "CreditsDepleted');
    expect(summary.waitingUntil).toBe(new Date(now + CREDITS_RETRY_MS).toISOString());
    const calls = fake.requests.length;
    now += 10 * 60_000;
    await svc.wipe.advance(); // still waiting: no call at all
    expect(fake.requests.length).toBe(calls);

    fake.outOfCredits = false; // credits added
    now += CREDITS_RETRY_MS;
    const timelineReads = fake.requests.filter((q) => q.path.endsWith('/tweets')).length;
    await runTicks();
    expect(fake.tweetsBy(user.userId)).toEqual([]);
    summary = await wipeOf();
    expect(summary).toMatchObject({ status: 'done', counts: { posts: 6, failed: 0 } });
    expect(summary.lastError).toBeUndefined();
    // The queued posts were not read again: only the follow-up pass reads the timeline.
    expect(fake.requests.filter((q) => q.path.endsWith('/tweets')).length).toBe(timelineReads + 1);
  });

  it('stops on revoked tokens and marks the account', async () => {
    fake.seedPost(user.userId);
    user.revoked = true;
    await request(app).post(`/api/accounts/${ID}/wipe`).send({ confirm: 'brand_one' });
    await runTicks();
    expect(await wipeOf()).toMatchObject({ status: 'failed' });
    expect(svc.accounts.get(ID)?.status).toBe('revoked');
  });

  it('can be cancelled, and refuses a second job while one runs', async () => {
    for (let i = 0; i < 30; i++) fake.seedPost(user.userId);
    fake.windows.set('deletePost', { remaining: 3, reset: Math.floor(now / 1000) + 900 });
    await request(app).post(`/api/accounts/${ID}/wipe`).send({ confirm: 'brand_one' });
    await svc.wipe.advance();
    const again = await request(app)
      .post(`/api/accounts/${ID}/wipe`)
      .send({ confirm: 'brand_one' });
    expect(again.status).toBe(409);
    const cancel = await request(app).post(`/api/accounts/${ID}/wipe/cancel`).send();
    expect(cancel.status).toBe(200);
    expect(await wipeOf()).toMatchObject({ status: 'cancelled', queued: 0 });
    now += 60 * 60_000;
    fake.windows.delete('deletePost');
    await svc.wipe.advance();
    expect(fake.tweetsBy(user.userId)).toHaveLength(27);
  });
});
