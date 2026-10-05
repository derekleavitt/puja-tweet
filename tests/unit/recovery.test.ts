/**
 * "Whatever happens, the repeat interval recovers and continues smoothly with an accurate history."
 * Long conversations under a tiny shared log cap, single-mode history under log trimming, transient
 * vs persistent failures, a crash between X accepting a post and the state write, restarts and
 * downtime, all through the real scheduler + drop path (X and Gemini stubbed).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetGeminiCallCounter } from '../../server/geminiConfig.js';
import { scheduler } from '../../server/scheduler.js';
import {
  BOOT_ID,
  staleInFlightMs,
  transientRetryDelayMs,
} from '../../server/services/contextService.js';
import { HttpError } from '../../server/middleware/error.js';
import { createDropService, dropService } from '../../server/services/dropService.js';
import { createServices, services, type Services } from '../../server/services/index.js';
import { MemoryStore } from '../../server/store/MemoryStore.js';
import { resolveTemplateText } from '../../server/templateAgent.js';
import {
  oauth1AccessToken,
  oauth1RequestToken,
  postColorTweet,
} from '../../server/twitterClient.js';
import type { BotState } from '../../server/store/Store.js';
import type { TweetContext } from '../../shared/types.js';

const generateContent = vi.fn();
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent: (...a: unknown[]) => generateContent(...a) };
  },
}));
vi.mock('../../server/twitterClient.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../server/twitterClient.js')>()),
  postColorTweet: vi.fn(),
  oauth1RequestToken: vi.fn(),
  oauth1AccessToken: vi.fn(),
}));

const post = vi.mocked(postColorTweet);
const MIN = 60_000;
const HOUR = 60 * MIN;
const TARGET = '1700000000000000001';
let now = Date.UTC(2026, 9, 5, 12, 0, 0);
let nextId = 1_900_000_000_000_000_000n;

type PostOpts = { text: string; replyToTweetId?: string; engagementMode?: string };
const okPost = async (_c: unknown, o: PostOpts, dry?: boolean) => {
  const id = String(nextId++);
  return {
    success: true,
    tweetId: dry ? `sim_${id}` : id,
    text: o.text,
    url: 'u',
    simulated: !!dry,
    replyTo: o.replyToTweetId,
    engagementMode: o.engagementMode,
  };
};

/**
 * Gemini stub. Conversation turns: "Point N." (N = the turn asked for). Summaries: "Covered turns
 * 1 to B." when the folded turns continue the previous summary without a gap, else "GAP".
 * Poetry: "Poem N." in call order.
 */
let poems = 0;
let geminiBusy = 0;
const gemini = async (req: { contents: string; config: { systemInstruction: string } }) => {
  if (geminiBusy > 0) throw new Error('{"error":{"code":503,"status":"UNAVAILABLE"}}');
  const sys = req.config.systemInstruction;
  if (sys.startsWith('You condense')) {
    const prev = /Covered turns 1 to (\d+)\./.exec(req.contents);
    const from = prev ? Number(prev[1]) : 0;
    const folded = [...req.contents.matchAll(/\[Turn (\d+)\]/g)].map((m) => Number(m[1]));
    const contiguous = folded.every((t, i) => t === from + 1 + i);
    return { text: contiguous ? `Covered turns 1 to ${from + folded.length}.` : 'GAP.' };
  }
  if (sys.startsWith('You write ONE reply')) {
    return { text: `Point ${/WRITE TURN (\d+) AS/.exec(req.contents)![1]}.` };
  }
  poems += 1;
  return { text: `Poem ${poems}.` };
};

const connect = async (userId: string, handle: string, svc: Services = services) => {
  vi.mocked(oauth1RequestToken).mockResolvedValueOnce({
    oauthToken: `req-${userId}`,
    oauthTokenSecret: 'rs',
    callbackConfirmed: true,
  });
  vi.mocked(oauth1AccessToken).mockResolvedValueOnce({
    accessToken: `token-${userId}`,
    accessTokenSecret: `secret-${userId}`,
    userId,
    screenName: handle,
  });
  await svc.accounts.startConnect('oob');
  return (await svc.accounts.completeConnect(`req-${userId}`, '1234')).id;
};

let ann: string;
let ben: string;

beforeEach(async () => {
  vi.stubEnv('CREDENTIALS_ENCRYPTION_KEY', 'd'.repeat(64));
  vi.stubEnv('TWITTER_API_KEY', 'k');
  vi.stubEnv('TWITTER_API_SECRET', 's');
  vi.stubEnv('TWITTER_ACCESS_TOKEN', 'env-token');
  vi.stubEnv('TWITTER_ACCESS_TOKEN_SECRET', 'env-secret');
  vi.stubEnv('GEMINI_API_KEY', 'test-key');
  vi.stubEnv('GEMINI_BUSY_RETRY_MS', '0');
  vi.stubEnv('GEMINI_MAX_CALLS_PER_DAY', '');
  resetGeminiCallCounter();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  now += 24 * HOUR; // past any spacing / cooldown of the previous test
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  post.mockReset().mockImplementation(okPost as never);
  generateContent.mockReset().mockImplementation(gemini);
  geminiBusy = 0;
  poems = 0;
  for (const c of services.contexts.getContexts()) c.enabled = false;
  services.logs.clearLogs();
  services.rateLimit.clearCooldown();
  services.settings.updateSettings({ globalDryRun: false, globalPaused: false });
  ann ??= await connect('9101', 'ann');
  ben ??= await connect('9102', 'ben');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const ctxOf = (id: string, svc: Services = services) => svc.contexts.getContext(id)!;

const makeConversation = (svc: Services = services) =>
  svc.contexts.createContext({
    name: 'Long chat',
    targetTweetId: TARGET,
    mode: 'conversation',
    enabled: true,
    dryRun: false,
    schedule: { mode: 'interval', intervalMinutes: 1, humanizeJitterEnabled: false },
    conversation: {
      participants: [
        { accountId: ann, persona: 'Ann' },
        { accountId: ben, persona: 'Ben' },
      ],
      sharedPrompt: 'Tea or coffee',
      openingPost: 'Tea or coffee? @ann @ben',
      openerHandle: 'owner',
      firstSpeakerAccountId: ann,
    },
  });

/** Another campaign's noise: `n` log entries that push older ones out of the shared log. */
const flood = (n: number) => {
  for (let i = 0; i < n; i++) {
    services.logs.addLog({
      ...services.logs.getLogs()[0],
      id: `noise_${now}_${i}`,
      contextId: 'ctx_noise',
      tweetId: undefined,
      conversationRunId: undefined,
      turn: undefined,
      tweetText: 'noise',
      status: 'success',
    });
  }
};

const turnPrompts = () =>
  generateContent.mock.calls
    .map((c) => c[0] as { contents: string; config: { systemInstruction: string } })
    .filter((r) => r.config.systemInstruction.startsWith('You write ONE reply'))
    .map((r) => r.contents);

/** Summary + buffer must cover turns 1..turnCount exactly, with no gap and no overlap. */
const expectCoverage = (ctx: TweetContext) => {
  const st = ctx.conversationState!;
  const through = st.summaryThroughTurn ?? 0;
  if (through > 0) expect(st.summary).toBe(`Covered turns 1 to ${through}.`);
  expect(st.turns!.map((t) => t.turn)).toEqual(
    Array.from({ length: st.turnCount - through }, (_, i) => through + 1 + i),
  );
};

describe('conversation history is kept on the campaign, not in the shared log', () => {
  it('45 turns under MAX_LOGS=20 with a flooding campaign: summary + verbatim turns, no gaps', async () => {
    vi.stubEnv('MAX_LOGS', '20');
    const c = makeConversation();
    services.contexts.setContextLastPostedTimestamp(c.id, now - MIN);
    const tweets: string[] = [];
    for (let n = 1; n <= 45; n++) {
      await scheduler.tick();
      const st = ctxOf(c.id).conversationState!;
      expect(st.turnCount).toBe(n);
      tweets.push(ctxOf(c.id).lastPostedTweetId!);
      expectCoverage(ctxOf(c.id));
      flood(30); // the shared log now holds nothing of this conversation
      now += MIN;
    }
    expect(services.logs.getLogs().some((l) => l.contextId === c.id)).toBe(false);
    expect(post).toHaveBeenCalledTimes(45);
    // Each turn replies to the previous one: one unbroken thread.
    post.mock.calls.forEach((call, i) =>
      expect((call[1] as PostOpts).replyToTweetId).toBe(i === 0 ? TARGET : tweets[i - 1]),
    );

    // The prompt of every turn N shows the summary of 1..S and turns S+1..N-1 word for word.
    const prompts = turnPrompts();
    expect(prompts).toHaveLength(45);
    prompts.forEach((p, i) => {
      const n = i + 1;
      const s = /summary of turns 1–(\d+)\):\n(.*)/.exec(p);
      const through = s ? Number(s[1]) : 0;
      if (s) expect(s[2]).toBe(`Covered turns 1 to ${through}.`);
      expect(p).not.toContain('GAP');
      for (let t = 1; t < n; t++) {
        if (t <= through) expect(p).not.toContain(`[Turn ${t}] `);
        else expect(p).toMatch(new RegExp(`\\[Turn ${t}\\] @(ann|ben): "Point ${t}\\. @`));
      }
      // At least the last 15 turns are always verbatim; never more than 20.
      expect(n - 1 - through).toBeGreaterThanOrEqual(Math.min(15, n - 1));
      expect(n - 1 - through).toBeLessThanOrEqual(20);
    });
    // Bounded on the campaign (Firestore document size).
    expect(ctxOf(c.id).conversationState!.turns!.length).toBeLessThanOrEqual(21);
  });

  it('keeps every turn when the summary call keeps failing, and folds without AI past the cap', async () => {
    const c = makeConversation();
    services.contexts.setContextLastPostedTimestamp(c.id, now - MIN);
    generateContent.mockImplementation(async (req) => {
      if (req.config.systemInstruction.startsWith('You condense')) throw new Error('down');
      return gemini(req);
    });
    for (let n = 1; n <= 50; n++) {
      await scheduler.tick();
      now += MIN;
    }
    const st = ctxOf(c.id).conversationState!;
    expect(st.turnCount).toBe(50);
    expect(st.turns!.length).toBe(40);
    expect(st.summaryThroughTurn).toBe(10);
    expect(st.summary).toContain('Point 10.');
    expect(st.turns![0].turn).toBe(11);
  });

  it('a legacy conversation without a buffer is seeded from whatever the log still has', async () => {
    const c = makeConversation();
    services.contexts.setContextLastPostedTimestamp(c.id, now - MIN);
    for (let n = 1; n <= 3; n++) {
      await scheduler.tick();
      now += MIN;
    }
    delete ctxOf(c.id).conversationState!.turns; // state written before the buffer existed
    await scheduler.tick();
    expect(turnPrompts()[3]).toContain('[Turn 3] @ann: "Point 3.');
    expect(ctxOf(c.id).conversationState!.turns!.map((t) => t.turn)).toEqual([1, 2, 3, 4]);
  });

  it('restart keeps nothing, resume (new round) keeps the transcript', async () => {
    const c = makeConversation();
    services.contexts.patchContext(c.id, { conversation: { ...c.conversation!, maxTurns: 2 } });
    services.contexts.setContextLastPostedTimestamp(c.id, now - MIN);
    await scheduler.tick();
    now += MIN;
    await scheduler.tick();
    expect(ctxOf(c.id).enabled).toBe(false); // round finished
    services.contexts.patchContext(c.id, { enabled: true });
    expect(ctxOf(c.id).conversationState!.turns).toHaveLength(2);
    services.contexts.restartConversation(c.id, {
      targetTweetId: '1700000000000000999',
      openingPost: 'New topic @ann @ben',
      firstSpeakerAccountId: ann,
    });
    expect(ctxOf(c.id).conversationState!.turns).toBeUndefined();
  });
});

describe('single-mode series history survives log trimming', () => {
  it('the <history> prompt shows the campaign’s own last 10 posts', async () => {
    vi.stubEnv('MAX_LOGS', '20');
    const id = services.contexts.createContext({
      name: 'Series',
      targetTweetId: TARGET,
      enabled: true,
      dryRun: false,
      hashtags: [],
      template: '<history><agent>Write the next line</agent></history>',
      schedule: { mode: 'interval', intervalMinutes: 1, humanizeJitterEnabled: false },
    }).id;
    services.contexts.setContextLastPostedTimestamp(id, now - MIN);
    for (let i = 1; i <= 13; i++) {
      await scheduler.tick();
      flood(30);
      now += MIN;
    }
    expect(services.logs.getLogs().some((l) => l.contextId === id)).toBe(false);
    const last = generateContent.mock.calls.at(-1)![0].contents as string;
    for (let p = 3; p <= 12; p++) expect(last).toContain(`"Poem ${p}."`);
    expect(last).not.toContain('"Poem 2."');
    const recent = ctxOf(id).recentPosts!;
    expect(recent).toHaveLength(10);
    expect(recent[9]).toMatchObject({ text: 'Poem 13.' });
    expect(recent[9].colorHex).toMatch(/^#/);
  });

  it('legacy campaigns are seeded once from the remaining logs', async () => {
    const id = services.contexts.createContext({
      name: 'Legacy',
      targetTweetId: TARGET,
      hashtags: [],
      template: 'x',
    }).id;
    const base = { ...services.logs.getLogs()[0], contextId: id, status: 'success' as const };
    services.logs.addLog({ ...base, id: 'l1', tweetText: 'old one' });
    services.logs.addLog({ ...base, id: 'l2', tweetText: 'old two' });
    delete ctxOf(id).recentPosts;
    expect(services.contexts.getRecentPosts(id)!.map((p) => p.text)).toEqual([
      'old one',
      'old two',
    ]);
  });
});

describe('transient failures back off and never pause; persistent ones still do', () => {
  const aiOnly = () => {
    const id = services.contexts.createContext({
      name: 'AI only',
      targetTweetId: TARGET,
      enabled: true,
      dryRun: false,
      hashtags: [],
      template: '<agent>Write a line</agent>',
      schedule: { mode: 'interval', intervalMinutes: 1, humanizeJitterEnabled: false },
    }).id;
    services.contexts.setContextLastPostedTimestamp(id, now - MIN);
    return id;
  };

  it('Gemini busy 6x in a row: 1, 2, 4, 8, 15, 15 minutes, then a success resets', async () => {
    const id = aiOnly();
    geminiBusy = 6;
    const delays: number[] = [];
    for (let i = 1; i <= 6; i++) {
      await scheduler.tick();
      geminiBusy--;
      const ctx = ctxOf(id);
      expect(ctx.enabled).toBe(true);
      expect(ctx.consecutiveErrors ?? 0).toBe(0);
      expect(ctx.retry).toMatchObject({ transient: true, attempt: i, reason: 'AI busy' });
      delays.push((ctx.retry!.at - now) / MIN);
      if (i === 2) expect(scheduler.getBlockedReason(ctx)).toMatch(/^Retrying in 2m \(AI busy/);
      // Not due before the retry time: no extra attempt in between.
      now = ctx.retry!.at - 31_000;
      await scheduler.tick();
      expect(ctxOf(id).retry!.attempt).toBe(i);
      now = ctx.retry!.at;
    }
    expect(delays).toEqual([1, 2, 4, 8, 15, 15]);
    expect(post).not.toHaveBeenCalled();
    expect(services.logs.getLogs().filter((l) => l.contextId === id)).toHaveLength(6);

    await scheduler.tick();
    expect(post).toHaveBeenCalledTimes(1);
    const ctx = ctxOf(id);
    expect(ctx).toMatchObject({ enabled: true, consecutiveErrors: 0 });
    expect(ctx.retry).toBeUndefined();
    expect(ctx.lastPostedTimestamp).toBe(now);
    expect(scheduler.getBlockedReason(ctx)).toBeUndefined();
    expect(scheduler.getNextScheduledPost(id)!.secondsUntil).toBe(60);
  });

  it('X 5xx and network errors are transient too', async () => {
    const id = aiOnly();
    post.mockResolvedValueOnce({
      success: false,
      error: 'over capacity',
      httpStatus: 503,
    } as never);
    await scheduler.tick();
    expect(ctxOf(id).retry).toMatchObject({ transient: true, reason: 'X server error' });
    now = ctxOf(id).retry!.at;
    post.mockResolvedValueOnce({
      success: false,
      error: 'X API timeout',
      isTimeout: true,
    } as never);
    await scheduler.tick();
    expect(ctxOf(id).retry).toMatchObject({ transient: true, attempt: 2, reason: 'network error' });
    expect(ctxOf(id).consecutiveErrors ?? 0).toBe(0);
  });

  it('persistent errors still pause after 5, transient ones in between do not count', async () => {
    const id = aiOnly();
    const fail = (status: number) =>
      post.mockResolvedValueOnce({
        success: false,
        error: `http ${status}`,
        httpStatus: status,
        rawResponse: { status, detail: 'bad' },
      } as never);
    let lastDelay = 0;
    const attempt = async () => {
      const at = now;
      await scheduler.tick();
      lastDelay = (ctxOf(id).retry?.at ?? at) - at;
      now = ctxOf(id).retry?.at ?? now + MIN;
    };
    for (const status of [400, 503, 400, 500, 400, 400]) {
      fail(status);
      await attempt();
    }
    expect(ctxOf(id)).toMatchObject({ enabled: true, consecutiveErrors: 4 });
    expect(ctxOf(id).retry).toMatchObject({ transient: false, reason: 'last post failed' });
    expect(lastDelay).toBe(15 * MIN);
    fail(400);
    await attempt();
    expect(ctxOf(id).enabled).toBe(false);
    expect(ctxOf(id).autoPausedReason).toMatch(/5 consecutive errors/);
  });

  it('the back-off grows from the interval and is capped at 15 minutes', () => {
    expect([1, 2, 3, 4, 5, 6].map((a) => transientRetryDelayMs(1, a) / MIN)).toEqual([
      1, 2, 4, 8, 15, 15,
    ]);
    expect(transientRetryDelayMs(5, 1) / MIN).toBe(5);
    expect(transientRetryDelayMs(5, 2) / MIN).toBe(10);
    expect(transientRetryDelayMs(60, 1) / MIN).toBe(15);
    expect(transientRetryDelayMs(0, 1) / MIN).toBe(1);
  });
});

describe('crash safety, restarts and downtime', () => {
  /** A drop service over its own services (another "process" reading the same store). */
  const dropsFor = (svc: Services) =>
    createDropService({ services: svc, postColorTweet, resolveTemplateText });

  it('crash between X accepting a turn and the state write: at most one duplicate, coherent history', async () => {
    const store = new MemoryStore();
    const svc = await createServices(store);
    const c = await makeConversationIn(svc);
    const drops = dropsFor(svc);
    for (let n = 1; n <= 3; n++) {
      await drops.executeDrop({ contextId: c.id, source: 'scheduler' });
      now += MIN;
    }
    await svc.flush();
    const anchorBefore = ctxOf(c.id, svc).lastPostedTweetId;

    // Turn 4: X accepts the tweet, then the process dies before anything else is written.
    let crashed: BotState | undefined;
    post.mockImplementationOnce((async (creds: unknown, opts: PostOpts, dry?: boolean) => {
      crashed = store.snapshot(); // what survives the crash: the in-flight marker, not the result
      return okPost(creds, opts, dry);
    }) as never);
    await drops.executeDrop({ contextId: c.id, source: 'scheduler' });
    const duplicateOf = post.mock.calls.length - 1;
    const lost = (await post.mock.results[duplicateOf].value) as { tweetId: string };
    expect(crashed!.contexts.find((x) => x.id === c.id)!.inFlight).toMatchObject({
      turn: 4,
      replyToTweetId: anchorBefore,
    });
    (crashed!.contexts.find((x) => x.id === c.id)!.inFlight as { bootId: string }).bootId =
      'boot_dead'; // another process wrote it

    // The new instance boots from what was persisted.
    const svc2 = await createServices(new MemoryStore(crashed));
    const drops2 = dropsFor(svc2);
    const st = ctxOf(c.id, svc2).conversationState!;
    expect(st.turnCount).toBe(3);
    // A fresh marker of another process: wait (it may still be posting).
    await expect(
      drops2.executeDrop({ contextId: c.id, source: 'scheduler' }),
    ).rejects.toMatchObject({ status: 409 });
    now += 91_000; // stale after max(3 x X timeout, 90 s): cleared, logged as interrupted, continues
    const out = await drops2.executeDrop({ contextId: c.id, source: 'scheduler' });
    expect(out.success).toBe(true);
    const turn4Posts = post.mock.calls.filter((call) =>
      (call[1] as PostOpts).text.startsWith('Point 4.'),
    );
    expect(turn4Posts).toHaveLength(2); // the documented bound: one duplicate, never more
    expect((turn4Posts[1][1] as PostOpts).replyToTweetId).toBe(anchorBefore);
    const after = ctxOf(c.id, svc2);
    expect(after.inFlight).toBeUndefined();
    expect(after.conversationState!.turnCount).toBe(4);
    expect(after.conversationState!.turns!.map((t) => t.turn)).toEqual([1, 2, 3, 4]);
    expect(after.lastPostedTweetId).toBe(out.result.tweetId);
    expect(after.lastPostedTweetId).not.toBe(lost.tweetId);
    const interrupted = svc2.logs.getLogs().find((l) => /Interrupted/.test(l.errorMessage ?? ''));
    expect(interrupted).toMatchObject({ contextId: c.id, status: 'error', turn: 4 });
    expect(after.consecutiveErrors ?? 0).toBe(0);
  });

  it('a stale marker left by this same process is cleared on the next tick at once', async () => {
    const id = services.contexts.createContext({
      name: 'Marker',
      targetTweetId: TARGET,
      enabled: true,
      dryRun: false,
      hashtags: [],
      template: 'plain {hex}',
      schedule: { mode: 'interval', intervalMinutes: 1, humanizeJitterEnabled: false },
    }).id;
    services.contexts.setContextLastPostedTimestamp(id, now - MIN);
    ctxOf(id).inFlight = { startedAt: now - 1000, bootId: BOOT_ID, text: 'x' };
    await scheduler.tick();
    expect(post).toHaveBeenCalledTimes(1);
    expect(ctxOf(id).inFlight).toBeUndefined();
  });

  it('restart mid-conversation continues with the right speaker, turn, anchor and transcript', async () => {
    const store = new MemoryStore();
    const svc = await createServices(store);
    const c = await makeConversationIn(svc);
    const drops = dropsFor(svc);
    for (let n = 1; n <= 5; n++) {
      await drops.executeDrop({ contextId: c.id, source: 'scheduler' });
      now += MIN;
    }
    await svc.flush();
    const before = structuredClone(ctxOf(c.id, svc));

    const svc2 = await createServices(new MemoryStore(store.snapshot()));
    await dropsFor(svc2).executeDrop({ contextId: c.id, source: 'scheduler' });
    const call = post.mock.calls.at(-1)!;
    expect((call[1] as PostOpts).replyToTweetId).toBe(before.lastPostedTweetId);
    expect((call[0] as { accessToken: string }).accessToken).toBe(
      `token-${before.conversationState!.nextSpeakerAccountId === ann ? '9101' : '9102'}`,
    );
    const prompt = turnPrompts().at(-1)!;
    expect(prompt).toContain('WRITE TURN 6 AS @ben');
    for (let t = 1; t <= 5; t++) expect(prompt).toContain(`[Turn ${t}] `);
    const after = ctxOf(c.id, svc2).conversationState!;
    expect(after.turnCount).toBe(6);
    expect(after.turns!.map((t) => t.turn)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('3 hours of downtime then a tick: exactly one post, then the normal cadence', async () => {
    const id = services.contexts.createContext({
      name: 'Every minute',
      targetTweetId: TARGET,
      enabled: true,
      dryRun: false,
      hashtags: [],
      template: 'plain {hex}',
      schedule: { mode: 'interval', intervalMinutes: 1, humanizeJitterEnabled: false },
    }).id;
    services.contexts.setContextLastPostedTimestamp(id, now - 3 * HOUR);
    await scheduler.tick();
    await scheduler.tick();
    expect(post).toHaveBeenCalledTimes(1);
    now += 30_000;
    await scheduler.tick();
    expect(post).toHaveBeenCalledTimes(1);
    now += 30_000;
    await scheduler.tick();
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('a slow post does not push a 1-minute campaign past the next once-a-minute tick', async () => {
    vi.stubEnv('SCHEDULER_MODE', 'external');
    const id = services.contexts.createContext({
      name: 'Slow',
      targetTweetId: TARGET,
      enabled: true,
      dryRun: false,
      hashtags: [],
      template: 'plain {hex}',
      schedule: { mode: 'interval', intervalMinutes: 1, humanizeJitterEnabled: false },
    }).id;
    services.contexts.setContextLastPostedTimestamp(id, now - MIN);
    post.mockImplementation((async (c: unknown, o: PostOpts, d?: boolean) => {
      now += 20_000; // AI + X took 20 s
      return okPost(c, o, d);
    }) as never);
    const tickAt = now;
    await scheduler.tick();
    expect(ctxOf(id).lastPostedTimestamp).toBe(tickAt); // anchored to the start, not the answer
    now = tickAt + 60_000 + 700; // the next Cloud Scheduler tick (a little late)
    await scheduler.tick();
    expect(post).toHaveBeenCalledTimes(2);
  });
});

describe('fixed times after a missed tick', () => {
  type Evaluate = (c: unknown, n: number) => Promise<void>;
  const evaluate = (c: unknown, n: number) =>
    (scheduler as unknown as { evaluateContextSchedule: Evaluate }).evaluateContextSchedule(c, n);

  const fixed = (createdAt: number) => {
    now = createdAt;
    const ctx = services.contexts.createContext({
      name: 'Fixed',
      targetTweetId: TARGET,
      enabled: true,
      hashtags: [],
      template: 'x',
      schedule: {
        mode: 'fixed_times',
        scheduleTimes: ['06:00'],
        timezone: 'UTC',
        humanizeJitterEnabled: false,
      },
    });
    return ctx;
  };

  it('a slot missed by a late/busy tick still fires once within 10 minutes', async () => {
    const ctx = fixed(Date.UTC(2026, 11, 1, 5, 0));
    const exec = vi.spyOn(dropService, 'executeDrop').mockResolvedValue({} as never);
    await evaluate(ctx, Date.UTC(2026, 11, 1, 6, 3)); // the 06:00 tick never ran
    await evaluate(ctx, Date.UTC(2026, 11, 1, 6, 4));
    expect(exec).toHaveBeenCalledTimes(1);
    expect(ctx.lastPostedSlot).toBe('2026-12-01-06:00');
    await evaluate(ctx, Date.UTC(2026, 11, 1, 6, 30)); // outside the window: nothing
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it('never catches up a slot from before the campaign existed', async () => {
    const ctx = fixed(Date.UTC(2026, 11, 2, 6, 2));
    const exec = vi.spyOn(dropService, 'executeDrop').mockResolvedValue({} as never);
    await evaluate(ctx, Date.UTC(2026, 11, 2, 6, 3));
    expect(exec).not.toHaveBeenCalled();
  });

  it('a transient failure retries the same slot with back-off, for up to an hour', async () => {
    const ctx = fixed(Date.UTC(2026, 11, 3, 5, 0));
    const exec = vi.spyOn(dropService, 'executeDrop').mockImplementation(async (args) => {
      services.contexts.recordContextPostResult(
        ctx.id,
        'error',
        undefined,
        'reply',
        { errorClass: 'ai_unavailable' },
        { startedAt: now, slotKey: args?.slotKey },
      );
      return {} as never;
    });
    now = Date.UTC(2026, 11, 3, 6, 0, 5);
    await evaluate(ctx, now);
    expect(ctx.retry).toMatchObject({ slotKey: '2026-12-03-06:00', attempt: 1 });
    expect(ctx.retry!.at - now).toBe(MIN);
    now += MIN;
    await evaluate(ctx, now);
    expect(exec).toHaveBeenCalledTimes(2);
    expect(exec.mock.calls[1][0]).toMatchObject({ slotKey: '2026-12-03-06:00' });
    expect(ctx.retry!.attempt).toBe(2);
    now += 2 * HOUR; // gave up: the slot is too old
    await evaluate(ctx, now);
    expect(exec).toHaveBeenCalledTimes(2);
    expect(ctx.retry).toBeUndefined();
  });
});

/** The conversation campaign inside another services instance (same accounts connected there). */
async function makeConversationIn(svc: Services) {
  svc.settings.updateSettings({ globalDryRun: false, globalPaused: false });
  expect(await connect('9101', 'ann', svc)).toBe(ann);
  expect(await connect('9102', 'ben', svc)).toBe(ben);
  return makeConversation(svc);
}

describe('review regressions', () => {
  const single = (over: Parameters<typeof services.contexts.createContext>[0] = {}) =>
    services.contexts.createContext({
      name: 'Single',
      targetTweetId: TARGET,
      enabled: true,
      dryRun: false,
      hashtags: [],
      template: 'plain {hex}',
      schedule: { mode: 'interval', intervalMinutes: 1, humanizeJitterEnabled: false },
      ...over,
    }).id;
  const http = (status: number) =>
    ({
      success: false,
      error: `http ${status}`,
      httpStatus: status,
      rawResponse: { status, detail: 'x' },
    }) as never;

  it('1. a newer fixed slot fires while an older slot is in transient retry', async () => {
    now = Date.UTC(2027, 0, 4, 5, 0);
    const id = single({
      schedule: {
        mode: 'fixed_times',
        scheduleTimes: ['06:00', '06:05'],
        timezone: 'UTC',
        humanizeJitterEnabled: false,
      },
    });
    post
      .mockResolvedValueOnce(http(503))
      .mockResolvedValueOnce(http(503))
      .mockResolvedValueOnce(http(503));
    const attempts: string[] = [];
    for (let m = 0; m <= 12; m++) {
      now = Date.UTC(2027, 0, 4, 6, m, 1);
      const before = post.mock.calls.length;
      await scheduler.tick();
      if (post.mock.calls.length > before) attempts.push(`06:${String(m).padStart(2, '0')}`);
    }
    // 06:00 fails at 06:00, 06:01, 06:03; the 06:05 slot wins at 06:05 (no further 06:00 retry).
    expect(attempts).toEqual(['06:00', '06:01', '06:03', '06:05']);
    expect(ctxOf(id).lastPostedSlot).toBe('2027-01-04-06:05');
    expect(ctxOf(id).retry).toBeUndefined();
    expect(ctxOf(id).stats).toMatchObject({ successfulPosts: 1, failedPosts: 3 });
  });

  it('2. the external tolerance never lets a campaign post twice within one interval', async () => {
    vi.stubEnv('SCHEDULER_MODE', 'external');
    const c = makeConversation();
    services.contexts.setContextLastPostedTimestamp(c.id, now - MIN);
    await scheduler.tick();
    now += 35_000; // another speaker: per-account spacing does not stop it
    await scheduler.tick();
    expect(post).toHaveBeenCalledTimes(1);
    now += 25_000;
    await scheduler.tick();
    expect(post).toHaveBeenCalledTimes(2);

    ctxOf(c.id).enabled = false;
    const dry = single({ dryRun: true });
    services.contexts.setContextLastPostedTimestamp(dry, now - MIN);
    const logsOf = () => services.logs.getLogs().filter((l) => l.contextId === dry).length;
    await scheduler.tick();
    now += 31_000;
    await scheduler.tick();
    expect(logsOf()).toBe(1);
  });

  it('3. editing what/where a campaign posts, or restarting, drops the retry and breaker streak', async () => {
    const id = single({
      schedule: { mode: 'interval', intervalMinutes: 60, humanizeJitterEnabled: false },
    });
    services.contexts.setContextLastPostedTimestamp(id, now - HOUR);
    post.mockResolvedValue(http(400));
    for (let i = 0; i < 2; i++) {
      await scheduler.tick();
      now = ctxOf(id).retry!.at;
    }
    expect(ctxOf(id)).toMatchObject({ consecutiveErrors: 2, retry: { transient: false } });
    services.contexts.patchContext(id, { name: 'renamed' }); // cosmetic: kept
    expect(ctxOf(id).retry).toBeDefined();
    services.contexts.patchContext(id, { template: 'other {hex}' });
    expect(ctxOf(id).retry).toBeUndefined();
    expect(ctxOf(id).consecutiveErrors).toBe(0);

    const c = makeConversation();
    services.contexts.recordContextPostResult(c.id, 'error', undefined, 'reply', {
      errorClass: 'unknown',
    });
    expect(ctxOf(c.id).retry).toBeDefined();
    services.contexts.restartConversation(c.id, {
      targetTweetId: '1700000000000000777',
      openingPost: 'Again @ann @ben',
      firstSpeakerAccountId: ann,
    });
    expect(ctxOf(c.id)).toMatchObject({ consecutiveErrors: 0, retry: undefined });
  });

  it('4. a slow AI call does not make a 1-minute <agent> campaign skip the next tick', async () => {
    vi.stubEnv('SCHEDULER_MODE', 'external');
    generateContent.mockImplementation(async (req) => {
      now += 20_000; // Gemini takes 20 s
      return gemini(req);
    });
    const id = single({ template: '<agent>Write a line</agent>' });
    services.contexts.setContextLastPostedTimestamp(id, now - MIN);
    const tick = now;
    await scheduler.tick();
    now = tick + MIN + 500;
    await scheduler.tick();
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('(a) an AI turn that is not a valid tweet is transient', async () => {
    const svc = await createServices(new MemoryStore());
    const c = await makeConversationIn(svc);
    const drops = createDropService({
      services: svc,
      postColorTweet,
      resolveTemplateText,
      buildTurn: async () => {
        throw new HttpError(500, 'The generated conversation turn is not a valid tweet.');
      },
    });
    await drops.executeDrop({ contextId: c.id, source: 'scheduler' });
    expect(ctxOf(c.id, svc).retry).toMatchObject({ transient: true, reason: 'AI busy' });
    expect(ctxOf(c.id, svc).consecutiveErrors ?? 0).toBe(0);
    expect(ctxOf(c.id, svc).inFlight).toBeUndefined();
  });

  it('(b) a marker never sent to X (crash while the AI wrote) is cleared at once, silently', async () => {
    const id = single();
    services.contexts.setContextLastPostedTimestamp(id, now - MIN);
    ctxOf(id).inFlight = { startedAt: now - 1000, bootId: 'boot_dead' }; // no sentAt
    await scheduler.tick();
    expect(post).toHaveBeenCalledTimes(1);
    const interrupted = services.logs
      .getLogs()
      .some((l) => /Interrupted/.test(l.errorMessage ?? ''));
    expect(interrupted).toBe(false);
  });

  it('(c) a sent marker of another process blocks for max(3 x X timeout, 90 s) only', async () => {
    const id = single();
    services.contexts.setContextLastPostedTimestamp(id, now - MIN);
    ctxOf(id).inFlight = { startedAt: now, sentAt: now, bootId: 'boot_dead', text: 't' };
    now += 89_000;
    await scheduler.tick();
    expect(post).not.toHaveBeenCalled();
    expect(scheduler.getBlockedReason(ctxOf(id))).toBe('Posting now…');
    now += 2_000;
    await scheduler.tick();
    expect(post).toHaveBeenCalledTimes(1);
    vi.stubEnv('X_TIMEOUT_MS', '60000');
    expect(staleInFlightMs()).toBe(180_000);
  });
});
