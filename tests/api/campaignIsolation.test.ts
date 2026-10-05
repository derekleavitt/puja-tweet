/**
 * Campaign isolation through the HTTP API: the legacy Settings route edits ONE campaign by id,
 * switching the active campaign changes nothing, client payloads can never move a chain anchor,
 * and every per-campaign action (duplicate, clear-history, post-now, webhook, preview) touches
 * only the campaign it names. X is stubbed; nothing reaches the network.
 */

import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { postColorTweet } from '../../server/twitterClient.js';
import { makeApp, services } from '../helpers/makeApp.js';
import type { TweetContext } from '../../shared/types.js';

vi.mock('../../server/twitterClient.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/twitterClient.js')>();
  return { ...actual, postColorTweet: vi.fn() };
});

let nextId = 9000;
const post = vi.mocked(postColorTweet);
type PostOpts = {
  text: string;
  replyToTweetId?: string;
  quoteTweetId?: string;
  engagementMode?: string;
};

let app: ReturnType<typeof makeApp>;
const TA = '1000000000000000001';
const TB = '2000000000000000002';
let A: string;
let B: string;

const ctx = (id: string) => services.contexts.getContext(id)!;
const snapshot = (id: string): TweetContext => JSON.parse(JSON.stringify(ctx(id)));
const anchor = (id: string, tweetId: string) =>
  services.contexts.recordContextPostResult(id, 'success', tweetId, 'reply');
const put = (id: string, body: unknown) => request(app).put(`/api/contexts/${id}`).send(body);

beforeAll(() => {
  app = makeApp();
});

beforeEach(() => {
  post.mockReset().mockImplementation((async (_c: unknown, o: PostOpts, dry: boolean) => ({
    success: true,
    tweetId: dry ? `sim_${nextId++}` : String(nextId++),
    text: o.text,
    url: 'u',
    simulated: dry,
    replyTo: o.replyToTweetId,
    quoteTweetId: o.quoteTweetId,
    engagementMode: o.engagementMode,
  })) as never);
  for (const c of services.contexts.getContexts().slice(1)) services.contexts.deleteContext(c.id);
  services.logs.clearLogs();
  services.settings.updateSettings({ globalDryRun: false, globalPaused: false });
  A = services.contexts.createContext({
    name: 'A',
    targetTweetId: TA,
    replyTargetMode: 'last_comment',
    template: 'A {color_pick} #alpha',
    schedule: { intervalMinutes: 1 },
    hashtagEvolution: { enabled: true, maxTags: 2 },
  }).id;
  B = services.contexts.createContext({
    name: 'B',
    targetTweetId: TB,
    replyTargetMode: 'last_comment',
    engagementMode: 'reply',
    dryRun: true,
    template: 'B {hex}',
    schedule: { intervalMinutes: 5 },
  }).id;
  services.contexts.setActiveContextId(A);
});

describe('POST /api/settings edits one campaign by id', () => {
  it('applies campaign fields to `contextId` only, whatever campaign is active', async () => {
    const bBefore = snapshot(B);
    const res = await request(app)
      .post('/api/settings')
      .send({ contextId: B, template: 'B edited {hex}', intervalMinutes: 30, dryRun: false })
      .expect(200);
    expect(res.body.settings).toMatchObject({ activeContextId: B, template: 'B edited {hex}' });
    expect(res.body.context.id).toBe(B);
    expect(res.body.queue.every((s: { contextId: string }) => s.contextId === B)).toBe(true);
    expect(ctx(B)).toMatchObject({ template: 'B edited {hex}', dryRun: false });
    expect(ctx(B).schedule.intervalMinutes).toBe(30);
    expect(ctx(A).template).toBe('A {color_pick} #alpha');
    expect(ctx(A).schedule.intervalMinutes).toBe(1);
    expect(ctx(B).targetTweetId).toBe(bBefore.targetTweetId);
    // The real active campaign did not change
    expect(services.contexts.getActiveContext().id).toBe(A);
  });

  it('without `contextId` edits the active campaign (legacy) and never another one', async () => {
    services.contexts.setActiveContextId(B);
    await request(app)
      .post('/api/settings')
      .send({ targetTweetId: '2000000000000000022' })
      .expect(200);
    expect(ctx(B).targetTweetId).toBe('2000000000000000022');
    expect(ctx(A).targetTweetId).toBe(TA);
  });

  it('rejects an unknown `contextId` with 404 instead of editing the active campaign', async () => {
    await request(app).post('/api/settings').send({ contextId: 'nope', template: 'x' }).expect(404);
    expect(ctx(A).template).toBe('A {color_pick} #alpha');
  });

  it('the global switches stay global and touch no campaign field', async () => {
    const a = snapshot(A);
    const b = snapshot(B);
    await request(app).post('/api/settings').send({ contextId: B, globalPaused: true }).expect(200);
    expect(services.settings.isGlobalPaused()).toBe(true);
    expect(snapshot(A)).toEqual(a);
    expect(snapshot(B)).toEqual(b);
  });
});

describe('switching the active campaign', () => {
  it('changes nothing on any campaign and only changes the settings view', async () => {
    anchor(A, '111');
    const before = JSON.stringify(services.contexts.getContexts());
    const res = await request(app).post(`/api/contexts/${B}/activate`).expect(200);
    expect(JSON.stringify(services.contexts.getContexts())).toBe(before);
    expect(res.body.queue.every((s: { contextId: string }) => s.contextId === B)).toBe(true);
    const status = await request(app).get('/api/status').expect(200);
    expect(status.body.settings).toMatchObject({ activeContextId: B, targetTweetId: TB });
    expect(status.body.settings.lastPostedTweetId).toBeUndefined();
    expect(status.body.nextPost.contextId).toBe(B);
    expect(ctx(A).lastPostedTweetId).toBe('111');
  });
});

describe('chain anchors are server-owned', () => {
  it('a PUT echoing the whole campaign (stale anchor) ignores the anchor and keeps the chain', async () => {
    anchor(A, '111');
    anchor(A, '112'); // the chain moved on after the form was opened
    const stale = { ...snapshot(A), lastPostedTweetId: '111', name: 'A renamed' };
    await put(A, stale).expect(200);
    expect(ctx(A)).toMatchObject({ name: 'A renamed', lastPostedTweetId: '112' });
    expect(ctx(A).chainAnchor?.tweetId).toBe('112');
  });

  it("a client can never adopt another campaign's tweet as an anchor", async () => {
    anchor(B, '222');
    await put(A, { lastPostedTweetId: '222' }).expect(200);
    expect(ctx(A).lastPostedTweetId).toBeUndefined();
    expect(services.contexts.getEffectiveReplyTargetId(ctx(A)).targetTweetId).toBe(TA);
  });

  it('pause/resume, schedule, hashtag, dry-run and name edits keep the chain position', async () => {
    anchor(A, '111');
    await request(app).post(`/api/contexts/${A}/toggle`).expect(200);
    await request(app).post(`/api/contexts/${A}/toggle`).expect(200);
    await put(A, {
      schedule: { mode: 'fixed_times', scheduleTimes: ['07:00'] },
      hashtagEvolution: { enabled: false },
      dryRun: true,
      name: 'A2',
      template: 'A2 {hex}',
    }).expect(200);
    await request(app)
      .post('/api/settings')
      .send({ contextId: A, intervalMinutes: 15 })
      .expect(200);
    expect(ctx(A).enabled).toBe(true);
    expect(services.contexts.getEffectiveReplyTargetId(ctx(A)).targetTweetId).toBe('111');
  });

  it('changing the target starts a new chain; an explicit null / reset-chain resets it', async () => {
    anchor(A, '111');
    anchor(B, '222');
    await put(A, { targetTweetId: '1000000000000000011' }).expect(200);
    expect(ctx(A).lastPostedTweetId).toBeUndefined();
    expect(services.contexts.getEffectiveReplyTargetId(ctx(A))).toMatchObject({
      targetTweetId: '1000000000000000011',
      isFirstInChain: true,
    });

    anchor(A, '113');
    await request(app)
      .post('/api/settings')
      .send({ contextId: A, lastPostedTweetId: null })
      .expect(200);
    expect(ctx(A).lastPostedTweetId).toBeUndefined();

    anchor(A, '114');
    await request(app).post(`/api/contexts/${A}/reset-chain`).expect(200);
    expect(ctx(A).chainAnchor).toBeUndefined();
    expect(ctx(B).lastPostedTweetId).toBe('222'); // B's chain untouched throughout
  });

  it('the Settings form "Reset to Root" for one campaign leaves the other chain alone', async () => {
    anchor(A, '111');
    anchor(B, '222');
    services.contexts.setActiveContextId(A);
    await request(app)
      .post('/api/settings')
      .send({ contextId: B, lastPostedTweetId: null })
      .expect(200);
    expect(ctx(B).lastPostedTweetId).toBeUndefined();
    expect(ctx(A).lastPostedTweetId).toBe('111');
  });
});

describe('per-campaign actions touch only the named campaign', () => {
  it('duplicate starts a fresh paused copy with the config but no chain or hashtag state', async () => {
    anchor(A, '111');
    services.contexts.setHashtagState(A, { current: ['x'], recent: ['x'] });
    const a = snapshot(A);
    const res = await request(app).post(`/api/contexts/${A}/duplicate`).expect(200);
    const copy = res.body.context as TweetContext;
    expect(copy).toMatchObject({ name: 'A (Copy)', targetTweetId: TA, enabled: false });
    expect(copy.hashtagEvolution).toEqual(a.hashtagEvolution);
    expect(copy.lastPostedTweetId).toBeUndefined();
    expect(copy.chainAnchor).toBeUndefined();
    expect(copy.hashtagState).toBeUndefined();
    expect(copy.stats?.totalPosts).toBe(0);
    expect(snapshot(A)).toEqual(a);
  });

  it("clear-history drops one campaign's logs and keeps its chain and the others' logs", async () => {
    await request(app).post('/api/post-now').send({ contextId: A, slotType: 'manual' }).expect(200);
    await request(app).post('/api/post-now').send({ contextId: B, slotType: 'manual' }).expect(200);
    const aAnchor = ctx(A).lastPostedTweetId;
    expect(aAnchor).toMatch(/^\d+$/);
    const res = await request(app).post(`/api/contexts/${A}/clear-history`).expect(200);
    expect(res.body.clearedCount).toBe(1);
    expect(res.body.logs.map((l: { contextId: string }) => l.contextId)).toEqual([B]);
    expect(ctx(A).lastPostedTweetId).toBe(aAnchor);
    expect(ctx(B).stats?.totalPosts).toBe(1);
  });

  it('post-now with a contextId posts that campaign even when another one is active', async () => {
    services.contexts.setActiveContextId(A);
    const res = await request(app).post('/api/post-now').send({ contextId: B, slotType: 'manual' });
    expect(res.status).toBe(200);
    const opts = post.mock.calls[0][1] as PostOpts;
    expect(opts.replyToTweetId).toBe(TB);
    expect(opts.text).toMatch(/^B /);
    expect(post.mock.calls[0][2]).toBe(true); // B's own dry-run, A is live
    expect(res.body.log.contextId).toBe(B);
    expect(ctx(A).stats?.totalPosts).toBe(0);
  });

  it('the webhook pins a campaign with contextId and /api/webhook/url can build that URL', async () => {
    const secret = services.credentials.getWebhookSecret();
    await request(app).post(`/api/webhook/trigger?secret=${secret}&contextId=${B}`).expect(200);
    expect((post.mock.calls[0][1] as PostOpts).replyToTweetId).toBe(TB);
    const url = await request(app).get(`/api/webhook/url?contextId=${B}`).expect(200);
    expect(url.body.url).toContain(`contextId=${B}`);
    await request(app).get('/api/webhook/url?contextId=nope').expect(404);
    await request(app).post(`/api/webhook/trigger?secret=${secret}&contextId=nope`).expect(404);
  });

  it("template/preview with a contextId renders that campaign's template and target", async () => {
    services.contexts.setActiveContextId(A);
    const res = await request(app).post('/api/template/preview').send({ contextId: B }).expect(200);
    expect(res.body.previewText).toMatch(/^B #/);
    expect(res.body.targetTweetId).toBe(TB);
    expect(res.body.hashtags).toBeUndefined(); // B does not evolve hashtags
  });
});
