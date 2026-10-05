/**
 * Conversation campaigns, true integration: three accounts connected through the real OAuth
 * endpoints, the real conversation service, drop service, scheduler and X client. Only the network
 * is faked: X (tests/helpers/fakeX.ts) and the Gemini SDK (persona-dependent, sometimes sloppy text).
 */

import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetGeminiCallCounter } from '../../server/geminiConfig.js';
import { checkTweetText } from '../../shared/tweetLength.js';
import type { PostLog, TweetContext } from '../../shared/types.js';
import { FakeX, type FakeUser } from '../helpers/fakeX.js';

const generateContent = vi.fn();
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent: (...a: unknown[]) => generateContent(...a) };
  },
}));

const { createApp } = await import('../../server/app.js');
const { scheduler } = await import('../../server/scheduler.js');
const { dropService } = await import('../../server/services/dropService.js');
const { services } = await import('../../server/services/index.js');

const TARGET = '1700000000000000001';
const NEW_TARGET = '1700000000000000009';
const KEY = 'd'.repeat(64);
const MIN = 60_000;
const ids = ['acct_5001', 'acct_5002', 'acct_5003'];
const handles = ['one', 'two', 'three'];

let fake: FakeX;
let now = Date.UTC(2026, 9, 5, 12, 0, 0);
let users: FakeUser[];
let app: ReturnType<typeof createApp>;
let errors: string[];
/** Set to make the stubbed Gemini fail every call. */
let geminiDown = false;

/**
 * Persona-dependent stub. It reads who speaks and who is addressed from the real prompt, and
 * misbehaves on purpose: turn 1 forgets the @mention, turn 2 mentions a stranger, turn 3 rambles
 * past 300 characters, turn 5 forgets again.
 */
const gemini = (req: { contents: string }) => {
  if (geminiDown) return Promise.reject(new Error('Gemini is down'));
  const m = /WRITE TURN (\d+) AS @(\w+)\. @(\w+) answers next/.exec(req.contents);
  if (!m) return Promise.resolve({ text: 'Unrelated.' });
  const [, n, speaker, next] = m;
  const voice = speaker === 'one' ? 'Quietly' : speaker === 'two' ? 'Loudly' : 'Dryly';
  const byTurn: Record<string, string> = {
    '1': `${voice}, coffee is a ritual and tea is a hug.`,
    '2': `${voice} asking @elonmusk and also @${next}, what would you say?`,
    '3': `${voice}, here is a very long thought. ${'It keeps going with more detail about leaves and beans. '.repeat(6)}`,
    '4': `${voice}, fair point, over to you @${next}`,
    '5': `${voice}, I will take the last word.`,
  };
  return Promise.resolve({ text: byTurn[n] ?? `${voice}, turn ${n} @${next}` });
};

const connect = async (user: FakeUser) => {
  const start = await request(app).post('/api/accounts/connect/start').send({ mode: 'pin' });
  const oauthToken = new URL(start.body.authorizeUrl).searchParams.get('oauth_token')!;
  const { verifier } = fake.authorize(oauthToken, user.userId);
  const done = await request(app)
    .post('/api/accounts/connect/complete')
    .send({ oauthToken, verifier });
  expect(done.status).toBe(200);
};

const ctxOf = (id: string): TweetContext => services.contexts.getContext(id)!;
const makeDue = (id: string) => services.contexts.setContextLastPostedTimestamp(id, now - 61 * MIN);
const tick = async (id: string, advance = 61) => {
  now += advance * MIN;
  makeDue(id);
  return scheduler.tick();
};
const speakerIndex = (authorId: string) => users.findIndex((u) => u.userId === authorId);

const createConversation = async (conv: Record<string, unknown> = {}) => {
  const res = await request(app)
    .post('/api/contexts')
    .send({
      name: 'Tea or coffee',
      targetTweetId: TARGET,
      mode: 'conversation',
      enabled: true,
      dryRun: false,
      schedule: { mode: 'interval', intervalMinutes: 60, humanizeJitterEnabled: false },
      conversation: {
        participants: ids.map((accountId, i) => ({ accountId, persona: `Persona ${i}` })),
        sharedPrompt: 'Friends argue about tea versus coffee.',
        openingPost: 'Tea or coffee? @one @two settle this.',
        openerHandle: 'owner',
        maxTurns: 5,
        ...conv,
      },
    });
  expect(res.status).toBe(200);
  return res.body.context as TweetContext;
};

beforeEach(async () => {
  geminiDown = false;
  errors = [];
  generateContent.mockReset();
  generateContent.mockImplementation((req: { contents: string }) => gemini(req));
  resetGeminiCallCounter();
  fake = new FakeX().install();
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  vi.stubEnv('TWITTER_API_KEY', fake.consumerKey);
  vi.stubEnv('TWITTER_API_SECRET', fake.consumerSecret);
  vi.stubEnv('TWITTER_ACCESS_TOKEN', '');
  vi.stubEnv('TWITTER_ACCESS_TOKEN_SECRET', '');
  vi.stubEnv('GEMINI_API_KEY', 'test-key');
  vi.stubEnv('CREDENTIALS_ENCRYPTION_KEY', KEY);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
    errors.push(a.map(String).join(' '));
  });
  app = createApp({ services, scheduler, drops: dropService, authDisabled: true });
  users = handles.map((h, i) => fake.addUser(`500${i + 1}`, h));
  if (!services.accounts.get(ids[0])) {
    for (const u of users) await connect(u);
  } else {
    // Accounts persist in the shared services; re-register their tokens with this fake X.
    for (const u of users) {
      const stored = services.accounts.getCredentialsForAccount(`acct_${u.userId}`)!;
      u.accessToken = stored.accessToken!;
      u.accessTokenSecret = stored.accessTokenSecret!;
    }
  }
  services.settings.updateSettings({ globalDryRun: false, globalPaused: false });
  services.rateLimit.clearCooldown();
  for (const c of services.contexts.getContexts()) {
    c.enabled = false;
    services.logs.clearContextHistory(c.id);
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const postNow = async (contextId: string) => {
  const preview = await request(app).post('/api/template/preview').send({ contextId });
  expect(preview.status).toBe(200);
  const c = preview.body.conversation;
  const res = await request(app)
    .post('/api/post-now')
    .send({
      contextId,
      text: preview.body.previewText,
      conversation: {
        runId: c.runId,
        turnNumber: c.turnNumber,
        speakerAccountId: c.speakerAccountId,
        nextSpeakerAccountId: c.nextSpeakerAccountId,
      },
    });
  return { preview: preview.body, res };
};

/** The stubbed Gemini prompts that asked for the given turn. */
const promptsForTurn = (n: number) =>
  generateContent.mock.calls
    .map((c) => c[0].contents as string)
    .filter((p) => p.includes(`WRITE TURN ${n} AS @`));

describe('conversation flow: three accounts, real services, fake X and Gemini', () => {
  it('runs a 5-turn conversation, finishes, then restarts with a clean transcript', async () => {
    const ctx = await createConversation();
    expect(ctx.conversationState!.turnCount).toBe(0);
    const firstRun = ctx.conversationState!.runId;

    // Preview, then post turn 1 now with the echo.
    const { preview, res } = await postNow(ctx.id);
    expect(preview.isFirstInChain).toBe(true);
    expect(preview.replyToTweetId).toBe(TARGET);
    expect(['one', 'two']).toContain(preview.accountHandle); // random among those mentioned
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const first = fake.tweets[0];
    const speaker = users.find((u) => u.screenName === preview.accountHandle)!;
    expect(first.token).toBe(speaker.accessToken);
    expect(first.authorId).toBe(speaker.userId);
    expect(first.inReplyTo).toBe(TARGET);
    const next = preview.conversation.nextSpeakerHandle;
    // Addresses the next speaker, then tags everyone else in the cast (anyone may reply).
    const others = users.map((u) => u.screenName).filter((h) => h !== speaker.screenName);
    for (const h of others) expect(first.text).toMatch(new RegExp(`@${h}\\b`));
    const cc = first.text.lastIndexOf(' cc ');
    if (cc >= 0) expect(first.text.indexOf(`@${next}`)).toBeLessThan(cc);
    expect(first.text).not.toMatch(/@elonmusk/i);
    expect(checkTweetText(first.text).ok).toBe(true);
    expect(ctxOf(ctx.id).chainAnchor?.tweetId).toBe(first.id);

    // Scheduler ticks until the campaign finishes itself.
    for (let i = 0; i < 4; i++) {
      const out = await tick(ctx.id);
      expect(out.fired).toBe(1);
    }
    expect((await tick(ctx.id)).fired).toBe(0); // finished: nothing more fires

    expect(fake.tweets).toHaveLength(5);
    expect(fake.requests.every((r) => r.signatureValid)).toBe(true);
    const turns = fake.tweets.map((t) => ({ ...t, speaker: speakerIndex(t.authorId) }));
    expect(turns.every((t) => t.token === users[t.speaker].accessToken)).toBe(true);
    for (let i = 1; i < 5; i++) {
      expect(turns[i].speaker).not.toBe(turns[i - 1].speaker);
      expect(turns[i].inReplyTo).toBe(turns[i - 1].id);
    }
    expect(turns[0].inReplyTo).toBe(TARGET);

    // Each turn addresses the next speaker; the stranger is de-@'d and the long text trimmed.
    for (let i = 0; i < 5; i++) {
      expect(checkTweetText(turns[i].text).ok).toBe(true);
      expect(turns[i].text).not.toMatch(/@elonmusk/i);
      if (i < 4) {
        expect(turns[i].text).toMatch(new RegExp(`@${handles[turns[i + 1].speaker]}\\b`, 'i'));
      }
    }
    expect(turns[1].text).toContain('elonmusk'); // kept as plain text, without the @

    // The prompt of turn 2 carries turn 1's real text; turn 1's did not.
    expect(promptsForTurn(1)[0]).toContain('No one has replied yet');
    expect(promptsForTurn(2)[0]).toContain(`@${handles[turns[0].speaker]}: "${turns[0].text}"`);

    // Logs, state, queue and status agree.
    const done = ctxOf(ctx.id);
    expect(done.conversationState!.turnCount).toBe(5);
    expect(done.enabled).toBe(false);
    expect(done.autoPausedReason).toBe('Conversation finished (5 turns)');
    const logs = (await request(app).get('/api/history')).body.logs as PostLog[];
    const mine = logs
      .filter((l) => l.contextId === ctx.id && l.status === 'success')
      .sort((a, b) => (a.turn ?? 0) - (b.turn ?? 0));
    expect(mine.map((l) => l.turn)).toEqual([1, 2, 3, 4, 5]);
    expect(mine.every((l) => l.conversationRunId === firstRun)).toBe(true);
    expect(mine.map((l) => l.accountId)).toEqual(turns.map((t) => ids[t.speaker]));
    const status = (await request(app).get('/api/status')).body;
    const sctx = status.contexts.find((c: TweetContext) => c.id === ctx.id);
    expect(sctx).toMatchObject({
      enabled: false,
      autoPausedReason: 'Conversation finished (5 turns)',
    });
    expect(status.stats.successfulPosts).toBe(5);
    expect((await request(app).get(`/api/queue?contextId=${ctx.id}`)).status).toBe(200);

    // Restart with a new target: clean run, replies to the new target, empty transcript.
    const restarted = await request(app).post(`/api/contexts/${ctx.id}/conversation/restart`).send({
      targetTweetId: NEW_TARGET,
      openingPost: 'Round two! @two @three go.',
      openerHandle: 'owner',
    });
    expect(restarted.status).toBe(200);
    const fresh = restarted.body.context as TweetContext;
    expect(fresh.conversationState!.turnCount).toBe(0);
    expect(fresh.conversationState!.runId).not.toBe(firstRun);
    expect(fresh.autoPausedReason).toBeUndefined();
    services.contexts.updateContext(ctx.id, { enabled: true });

    generateContent.mockClear();
    expect((await tick(ctx.id)).fired).toBe(1);
    expect(fake.tweets[5].inReplyTo).toBe(NEW_TARGET);
    expect(ctxOf(ctx.id).conversationState!.turnCount).toBe(1);
    const prompt = generateContent.mock.calls[0][0].contents as string;
    expect(prompt).toContain('No one has replied yet');
    expect(prompt).toContain('Round two!');
    expect(prompt).not.toContain('[Turn ');
    for (const t of turns) expect(prompt).not.toContain(t.text);
  });

  it('Gemini down for one tick: error log, same speaker next tick, anchor unchanged', async () => {
    const ctx = await createConversation({ firstSpeakerAccountId: ids[1] });
    geminiDown = true;
    await tick(ctx.id);
    expect(fake.tweets).toHaveLength(0);
    const err = services.logs.getLogs().find((l) => l.contextId === ctx.id)!;
    expect(err).toMatchObject({ status: 'error', accountId: ids[1], turn: 1 });
    expect(ctxOf(ctx.id).conversationState).toMatchObject({
      turnCount: 0,
      nextSpeakerAccountId: ids[1],
    });
    expect(ctxOf(ctx.id).chainAnchor).toBeUndefined();

    geminiDown = false;
    await tick(ctx.id, 31); // past the 15-minute back-off
    expect(fake.tweets).toHaveLength(1);
    expect(fake.tweets[0]).toMatchObject({ authorId: users[1].userId, inReplyTo: TARGET });
    expect(ctxOf(ctx.id).conversationState!.turnCount).toBe(1);
  });

  it('a single-mode campaign running alongside is unaffected', async () => {
    const ctx = await createConversation({ firstSpeakerAccountId: ids[1], maxTurns: 3 });
    const soloRes = await request(app)
      .post('/api/contexts')
      .send({
        name: 'Solo',
        targetTweetId: '1700000000000000555',
        accountId: ids[0],
        enabled: true,
        dryRun: false,
        template: 'solo {color_pick}',
        hashtags: [],
        schedule: { mode: 'interval', intervalMinutes: 60, humanizeJitterEnabled: false },
      });
    expect(soloRes.status).toBe(200);
    const solo = soloRes.body.context as TweetContext;

    // Both campaigns share account one's rate window, so a tick may favour either; keep ticking.
    const soloOf = () => fake.tweets.filter((t) => t.text.startsWith('solo'));
    for (let i = 0; i < 10 && soloOf().length < 3; i++) {
      now += 61 * MIN;
      makeDue(ctx.id);
      makeDue(solo.id);
      await scheduler.tick();
    }
    const soloTweets = soloOf();
    expect(soloTweets).toHaveLength(3);
    expect(soloTweets.every((t) => t.token === users[0].accessToken)).toBe(true);
    // Single campaigns reply to their own target (default reply mode), never to the chat.
    expect(soloTweets.every((t) => t.inReplyTo === '1700000000000000555')).toBe(true);

    while (ctxOf(ctx.id).enabled) await tick(ctx.id);
    const chat = fake.tweets.filter((t) => !t.text.startsWith('solo'));
    expect(chat).toHaveLength(3);
    expect(chat[0].inReplyTo).toBe(TARGET);
    expect(chat[1].inReplyTo).toBe(chat[0].id);
    expect(chat[2].inReplyTo).toBe(chat[1].id);
    expect(ctxOf(ctx.id).autoPausedReason).toBe('Conversation finished (3 turns)');
    expect(ctxOf(solo.id).enabled).toBe(true);
    expect(ctxOf(solo.id).lastPostedTweetId).toBe(soloTweets.at(-1)!.id);
    expect(errors).toEqual([]);
  });
});
