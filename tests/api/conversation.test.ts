/**
 * Conversation campaigns end to end against the fake X: three connected accounts take turns,
 * `buildTurn` is mocked to deterministic turns (the AI is covered elsewhere).
 */

import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../server/app.js';
import { scheduler } from '../../server/scheduler.js';
import { dropService } from '../../server/services/dropService.js';
import { services } from '../../server/services/index.js';
import { AgentUnavailableError } from '../../server/templateAgent.js';
import type { TweetContext } from '../../shared/types.js';
import { FakeX, type FakeUser } from '../helpers/fakeX.js';

const mocks = vi.hoisted(() => ({ failTurn: undefined as Error | undefined }));

vi.mock('../../server/services/conversationService.js', async () => {
  const { services: svc } = await import('../../server/services/index.js');
  /** Rotates through the cast: speaker = state.next, next = the following participant. */
  const buildTurn = async (ctx: TweetContext) => {
    if (mocks.failTurn) throw mocks.failTurn;
    const state = ctx.conversationState!;
    const ids = ctx.conversation!.participants.map((p) => p.accountId);
    const next = ids[(ids.indexOf(state.nextSpeakerAccountId) + 1) % ids.length];
    const nextHandle = svc.accounts.handleOf(next)!;
    return {
      runId: state.runId,
      turnNumber: state.turnCount + 1,
      speakerAccountId: state.nextSpeakerAccountId,
      speakerHandle: svc.accounts.handleOf(state.nextSpeakerAccountId)!,
      nextSpeakerAccountId: next,
      nextSpeakerHandle: nextHandle,
      text: `Turn ${state.turnCount + 1} thoughts @${nextHandle}`,
      replyToTweetId: svc.contexts.getEffectiveReplyTargetId({
        ...ctx,
        replyTargetMode: 'last_comment',
      }).targetTweetId,
      summaryUsed: false,
      transcriptLength: state.turnCount,
    };
  };
  return { buildTurn, createConversationService: () => ({ buildTurn }) };
});

const TARGET = '1700000000000000001';
const KEY = 'd'.repeat(64);
const MIN = 60_000;

let fake: FakeX;
let now = Date.UTC(2026, 9, 5, 12, 0, 0);
let users: FakeUser[];
let app: ReturnType<typeof createApp>;

const connect = async (user: FakeUser) => {
  const start = await request(app).post('/api/accounts/connect/start').send({ mode: 'pin' });
  const oauthToken = new URL(start.body.authorizeUrl).searchParams.get('oauth_token')!;
  const { verifier } = fake.authorize(oauthToken, user.userId);
  const done = await request(app)
    .post('/api/accounts/connect/complete')
    .send({ oauthToken, verifier });
  expect(done.status).toBe(200);
};

const ids = ['acct_4001', 'acct_4002', 'acct_4003'];

const makeConversation = (
  extra: Record<string, unknown> = {},
  conv: Record<string, unknown> = {},
) =>
  services.contexts.createContext({
    name: 'Chat',
    targetTweetId: TARGET,
    mode: 'conversation',
    enabled: true,
    dryRun: false,
    schedule: { mode: 'interval', intervalMinutes: 60, humanizeJitterEnabled: false },
    conversation: {
      participants: ids.map((accountId, i) => ({ accountId, persona: `Voice ${i}` })),
      sharedPrompt: 'Tea or coffee',
      openingPost: 'Hey @one @two @three, tea or coffee?',
      openerHandle: 'owner',
      firstSpeakerAccountId: ids[1],
      ...conv,
    },
    ...extra,
  } as Parameters<typeof services.contexts.createContext>[0]);

const ctxOf = (id: string) => services.contexts.getContext(id)!;
const makeDue = (id: string) => services.contexts.setContextLastPostedTimestamp(id, now - 61 * MIN);

beforeEach(async () => {
  mocks.failTurn = undefined;
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
  app = createApp({ services, scheduler, drops: dropService, authDisabled: true });
  if (!services.accounts.get(ids[0])) {
    users = [
      fake.addUser('4001', 'one'),
      fake.addUser('4002', 'two'),
      fake.addUser('4003', 'three'),
    ];
    for (const u of users) await connect(u);
  } else {
    // The accounts persist in the shared services; re-register them with this fake X.
    users = [
      fake.addUser('4001', 'one'),
      fake.addUser('4002', 'two'),
      fake.addUser('4003', 'three'),
    ];
    for (const u of users) {
      const stored = services.accounts.getCredentialsForAccount(`acct_${u.userId}`);
      if (stored) {
        u.accessToken = stored.accessToken!;
        u.accessTokenSecret = stored.accessTokenSecret!;
      }
    }
  }
  services.settings.updateSettings({ globalDryRun: false, globalPaused: false });
  services.rateLimit.clearCooldown();
  for (const c of services.contexts.getContexts()) {
    c.enabled = false;
    // The fake X restarts its tweet ids each test; stale logs must not match them.
    services.logs.clearContextHistory(c.id);
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const tweetsBy = (i: number) => fake.tweetsBy(users[i].userId);

describe('conversation preview and post-now', () => {
  it('previews the next turn with the conversation shape and no color fields', async () => {
    const c = makeConversation();
    const res = await request(app).post('/api/template/preview').send({ contextId: c.id });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      previewText: 'Turn 1 thoughts @three',
      replyToTweetId: TARGET,
      isFirstInChain: true,
      accountId: ids[1],
      accountHandle: 'two',
      conversation: {
        runId: c.conversationState!.runId,
        turnNumber: 1,
        speakerAccountId: ids[1],
        speakerHandle: 'two',
        nextSpeakerAccountId: ids[2],
        nextSpeakerHandle: 'three',
        summaryUsed: false,
        transcriptLength: 0,
      },
    });
    expect(res.body.charCount).toBe(res.body.previewText.length);
    for (const k of ['color', 'breakdown', 'hashtags']) expect(res.body).not.toHaveProperty(k);
  });

  it('post-now with the echoed turn posts as the speaker, replying to the anchor', async () => {
    const c = makeConversation();
    const preview = (await request(app).post('/api/template/preview').send({ contextId: c.id }))
      .body;
    const res = await request(app)
      .post('/api/post-now')
      .send({
        contextId: c.id,
        text: preview.previewText,
        conversation: {
          runId: preview.conversation.runId,
          turnNumber: preview.conversation.turnNumber,
          speakerAccountId: preview.conversation.speakerAccountId,
          nextSpeakerAccountId: preview.conversation.nextSpeakerAccountId,
        },
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(tweetsBy(1)).toHaveLength(1);
    expect(tweetsBy(1)[0]).toMatchObject({
      token: users[1].accessToken,
      inReplyTo: TARGET,
    });
    expect(tweetsBy(1)[0].text).toContain('@three');
    expect(res.body.log).toMatchObject({
      accountId: ids[1],
      accountHandle: 'two',
      turn: 1,
      nextSpeakerAccountId: ids[2],
      conversationRunId: c.conversationState!.runId,
    });
    expect(ctxOf(c.id).conversationState).toMatchObject({
      turnCount: 1,
      nextSpeakerAccountId: ids[2],
    });
    expect(ctxOf(c.id).chainAnchor?.tweetId).toBe(tweetsBy(1)[0].id);
  });

  it('a stale turn is a 409 and a text without the next @handle is a 400', async () => {
    const c = makeConversation();
    const echo = {
      runId: c.conversationState!.runId,
      turnNumber: 1,
      speakerAccountId: ids[1],
      nextSpeakerAccountId: ids[2],
    };
    const stale = await request(app)
      .post('/api/post-now')
      .send({ contextId: c.id, text: 'hi @three', conversation: { ...echo, turnNumber: 2 } });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toMatch(/moved on/);
    const wrongSpeaker = await request(app)
      .post('/api/post-now')
      .send({
        contextId: c.id,
        text: 'hi @three',
        conversation: { ...echo, speakerAccountId: ids[0] },
      });
    expect(wrongSpeaker.status).toBe(409);
    const noMention = await request(app)
      .post('/api/post-now')
      .send({ contextId: c.id, text: 'hi there', conversation: echo });
    expect(noMention.status).toBe(400);
    expect(fake.tweets).toHaveLength(0);
    expect(ctxOf(c.id).conversationState!.turnCount).toBe(0);
  });
});

describe('conversation scheduling', () => {
  it('4 ticks post 4 chained replies from rotating speakers, then finish at maxTurns', async () => {
    const c = makeConversation({}, { maxTurns: 4 });
    const speakers: number[] = [];
    for (let i = 0; i < 4; i++) {
      now += 61 * MIN;
      makeDue(c.id);
      const out = await scheduler.tick();
      expect(out.fired).toBe(1);
    }
    expect(fake.tweets).toHaveLength(4);
    for (const t of fake.tweets) speakers.push(users.findIndex((u) => u.userId === t.authorId));
    expect(speakers).toEqual([1, 2, 0, 1]);
    expect(fake.tweets.every((t) => users.some((u) => u.accessToken === t.token))).toBe(true);
    expect(fake.tweets[0].inReplyTo).toBe(TARGET);
    for (let i = 1; i < 4; i++) expect(fake.tweets[i].inReplyTo).toBe(fake.tweets[i - 1].id);
    const done = ctxOf(c.id);
    expect(done.conversationState!.turnCount).toBe(4);
    expect(done.enabled).toBe(false);
    expect(done.autoPausedReason).toBe('Conversation finished (4 turns)');
    expect(fake.requests.every((r) => r.signatureValid)).toBe(true);
  });

  it('a speaker on cooldown makes the conversation wait; single campaigns still fire', async () => {
    const c = makeConversation();
    const single = services.contexts.createContext({
      name: 'Solo',
      targetTweetId: TARGET,
      accountId: ids[0],
      enabled: true,
      dryRun: false,
      template: 'solo {color_pick}',
      hashtags: [],
      schedule: { mode: 'interval', intervalMinutes: 60, humanizeJitterEnabled: false },
    });
    now += 61 * MIN;
    services.rateLimit.setCooldown(15, 'test', ids[1]); // the next speaker
    makeDue(c.id);
    makeDue(single.id);
    const before = JSON.stringify(ctxOf(c.id).conversationState);
    await scheduler.tick();
    expect(fake.tweets.map((t) => t.authorId)).toEqual([users[0].userId]);
    expect(JSON.stringify(ctxOf(c.id).conversationState)).toBe(before);
    expect(scheduler.getBlockedReason(ctxOf(c.id))).toMatch(/^Next speaker @two: X cooldown/);
    expect(scheduler.getNextScheduledPost(c.id)).toMatchObject({ speakerHandle: 'two' });
    // The cooldown ends: the same speaker goes next.
    services.rateLimit.clearCooldown(ids[1]);
    now += 61 * MIN;
    makeDue(c.id);
    await scheduler.tick();
    expect(tweetsBy(1)).toHaveLength(1);
  });

  it('a failed post retries with the same speaker and leaves the anchor alone', async () => {
    const c = makeConversation();
    fake.failNextPost('4002', 500, { title: 'Boom' });
    now += 61 * MIN;
    makeDue(c.id);
    await scheduler.tick();
    expect(fake.tweets).toHaveLength(0);
    expect(ctxOf(c.id).conversationState).toMatchObject({
      turnCount: 0,
      nextSpeakerAccountId: ids[1],
    });
    expect(ctxOf(c.id).chainAnchor).toBeUndefined();
    now += 31 * MIN; // past the 15-minute back-off
    makeDue(c.id);
    await scheduler.tick();
    expect(tweetsBy(1)).toHaveLength(1);
    expect(tweetsBy(1)[0].inReplyTo).toBe(TARGET);
    expect(ctxOf(c.id).conversationState!.turnCount).toBe(1);
  });

  it('an unavailable AI logs an error and leaves the state untouched', async () => {
    const c = makeConversation();
    mocks.failTurn = new AgentUnavailableError('AI generation failed for every configured model.');
    now += 61 * MIN;
    makeDue(c.id);
    await scheduler.tick();
    expect(fake.tweets).toHaveLength(0);
    expect(ctxOf(c.id).conversationState).toMatchObject({
      turnCount: 0,
      nextSpeakerAccountId: ids[1],
    });
    const log = services.logs.getLogs().find((l) => l.contextId === c.id)!;
    expect(log).toMatchObject({ status: 'error', accountId: ids[1], turn: 1 });
    expect(ctxOf(c.id).consecutiveErrors).toBe(1);
  });

  it('a concurrent tick-style drop and post-now yield one post and one 409', async () => {
    const c = makeConversation();
    const echo = {
      runId: c.conversationState!.runId,
      turnNumber: 1,
      speakerAccountId: ids[1],
      nextSpeakerAccountId: ids[2],
    };
    const results = await Promise.allSettled([
      dropService.executeDrop({
        contextId: c.id,
        source: 'manual',
        text: 'go @three',
        conversation: echo,
      }),
      dropService.executeDrop({ contextId: c.id, source: 'scheduler' }),
    ]);
    expect(results[0].status).toBe('fulfilled');
    expect(results[1]).toMatchObject({ status: 'rejected', reason: { status: 409 } });
    expect(fake.tweets).toHaveLength(1);
    // The lock was released: the next turn goes through.
    const again = await dropService.executeDrop({ contextId: c.id, source: 'scheduler' });
    expect(again.success).toBe(true);
    expect(fake.tweets).toHaveLength(2);
  });
});

describe('conversation lifecycle', () => {
  it('queue slots: the first names the next speaker, later ones are random', async () => {
    const c = makeConversation();
    const res = await request(app).get(`/api/queue?contextId=${c.id}`);
    const slots = res.body.queue;
    expect(slots).toHaveLength(14);
    expect(slots[0]).toMatchObject({ speakerAccountId: ids[1], accountHandle: 'two' });
    for (const s of slots) expect(s.previewText).toBe('✨ AI turn, written when it posts');
    for (const s of slots.slice(1)) {
      expect(s.speakerAccountId).toBeUndefined();
      expect(s.accountHandle).toBeUndefined();
    }
  });

  it('restart route returns the refreshed context, contexts and queue', async () => {
    const c = makeConversation({}, { maxTurns: 1 });
    now += 61 * MIN;
    makeDue(c.id);
    await scheduler.tick();
    expect(ctxOf(c.id).autoPausedReason).toMatch(/finished/);
    const res = await request(app).post(`/api/contexts/${c.id}/conversation/restart`).send({
      targetTweetId: '1700000000000000009',
      openingPost: 'Round two @one @two @three',
      openerHandle: 'owner',
      firstSpeakerAccountId: ids[0],
    });
    expect(res.status).toBe(200);
    expect(res.body.context.conversationState).toMatchObject({
      turnCount: 0,
      nextSpeakerAccountId: ids[0],
    });
    expect(res.body.context.targetTweetId).toBe('1700000000000000009');
    expect(res.body.context.autoPausedReason).toBeUndefined();
    expect(Array.isArray(res.body.contexts)).toBe(true);
    expect(Array.isArray(res.body.queue)).toBe(true);
    const bad = await request(app).post(`/api/contexts/${c.id}/conversation/restart`).send({});
    expect(bad.status).toBe(400);
  });

  it('removing a participant pauses the conversation', async () => {
    const c = makeConversation();
    const res = await request(app).delete(`/api/accounts/${ids[2]}`);
    expect(res.status).toBe(200);
    expect(res.body.pausedCampaigns).toContain('Chat');
    expect(ctxOf(c.id).enabled).toBe(false);
    expect(ctxOf(c.id).autoPausedReason).toMatch(/^Participant @three removed/);
  });
});
