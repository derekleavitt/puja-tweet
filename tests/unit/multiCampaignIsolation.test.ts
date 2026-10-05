/**
 * Multi-campaign isolation through the scheduler and drop path (MemoryStore + stubbed X).
 * Three campaigns with different targets, modes, schedules, dry-run flags and hashtags run
 * through ticks, errors, back-off, cooldown, log trimming, restarts; nothing of one campaign may
 * ever touch another. See docs/campaign-isolation.md.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { postColorTweet } from '../../server/twitterClient.js';
import { scheduler } from '../../server/scheduler.js';
import { createServices, services } from '../../server/services/index.js';
import { MemoryStore } from '../../server/store/MemoryStore.js';

vi.mock('../../server/twitterClient.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/twitterClient.js')>();
  return { ...actual, postColorTweet: vi.fn() };
});

const post = vi.mocked(postColorTweet);
const MIN = 60_000;
let now = 1_800_000_000_000;
let nextId = 5000;

type PostOpts = {
  text: string;
  replyToTweetId?: string;
  quoteTweetId?: string;
  engagementMode?: string;
};

/** Default X stub: every post succeeds with a fresh numeric id (simulated when asked to). */
const okPost = async (_c: unknown, o: PostOpts, dry: boolean) => ({
  success: true,
  tweetId: dry ? `sim_${nextId++}` : String(nextId++),
  text: o.text,
  url: 'u',
  simulated: dry,
  replyTo: o.replyToTweetId,
  quoteTweetId: o.quoteTweetId,
  engagementMode: o.engagementMode,
});

const failWith =
  (httpStatus: number, error = `http ${httpStatus}`) =>
  async () => ({
    success: false,
    error,
    httpStatus,
    rawResponse: { status: httpStatus, detail: error },
  });

const campaign = (
  over: Parameters<typeof services.contexts.createContext>[0] & { name: string },
) => {
  const ctx = services.contexts.createContext({
    engagementMode: 'reply',
    replyTargetMode: 'original_post',
    dryRun: false,
    schedule: { mode: 'interval', intervalMinutes: 1, humanizeJitterEnabled: false },
    ...over,
  });
  due(ctx.id, 0);
  return ctx.id;
};

/** Makes a campaign due `secondsAgo` seconds ago (negative = not due yet). */
const due = (id: string, secondsAgo: number) => {
  const c = services.contexts.getContext(id)!;
  const interval = (c.schedule.intervalMinutes || 60) * MIN;
  services.contexts.setContextLastPostedTimestamp(id, now - interval - secondsAgo * 1000);
};

const ctx = (id: string) => services.contexts.getContext(id)!;
const callsFor = (target: string) =>
  post.mock.calls.filter((c) => (c[1] as PostOpts).replyToTweetId === target);
const snapshot = (id: string) => JSON.parse(JSON.stringify(ctx(id)));

let A: string;
let B: string;
let C: string;

beforeEach(() => {
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  post.mockReset().mockImplementation(okPost as never);
  for (const c of services.contexts.getContexts().slice(1)) services.contexts.deleteContext(c.id);
  services.logs.clearLogs();
  services.rateLimit.clearCooldown();
  services.settings.updateSettings({ globalDryRun: false, globalPaused: false });
  now += 60 * MIN; // past any live-post spacing left by the previous test
  A = campaign({
    name: 'A',
    targetTweetId: '1000',
    replyTargetMode: 'last_comment',
    template: 'A {color_pick} #alpha',
    hashtagEvolution: { enabled: true, maxTags: 2, keepSeedTags: false },
  });
  B = campaign({
    name: 'B',
    targetTweetId: '2000',
    engagementMode: 'quote',
    dryRun: true,
    schedule: { mode: 'interval', intervalMinutes: 5, humanizeJitterEnabled: false },
    template: 'B {hex}',
  });
  C = campaign({ name: 'C', targetTweetId: '3000', template: 'C {weather_desc}' });
  // The primary (first) campaign stays paused so only A, B, C take part.
  services.contexts.patchContext(services.contexts.getContexts()[0].id, { enabled: false });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('scheduler ticks keep campaigns apart', () => {
  it('each due campaign posts to its own target with its own template, mode and dry-run', async () => {
    due(B, -200); // B not due
    await scheduler.tick();
    now += 55_000; // past the global 50 s live spacing
    await scheduler.tick();

    const a = callsFor('1000');
    const c = callsFor('3000');
    expect(a).toHaveLength(1);
    expect(c).toHaveLength(1);
    expect((a[0][1] as PostOpts).text).toMatch(/^A /);
    expect((c[0][1] as PostOpts).text).toMatch(/^C /);
    expect(post.mock.calls.some((x) => (x[1] as PostOpts).quoteTweetId === '2000')).toBe(false);

    // B: not touched at all (clock, stats, log)
    const b = ctx(B);
    expect(b.stats?.totalPosts).toBe(0);
    expect(services.logs.getLogs().every((l) => l.contextId !== B)).toBe(true);

    // A got its own anchor with provenance; B never did; C only records its own reply.
    expect(ctx(A).chainAnchor).toMatchObject({
      tweetId: ctx(A).lastPostedTweetId,
      targetTweetId: '1000',
    });
    expect(ctx(B).lastPostedTweetId).toBeUndefined();
    expect(ctx(C).lastPostedTweetId).not.toBe(ctx(A).lastPostedTweetId);
  });

  it("a chain campaign replies to its own last reply, never to another campaign's tweet", async () => {
    await scheduler.tick(); // A posts (first in chain -> root 1000)
    const anchor = ctx(A).lastPostedTweetId!;
    now += 55_000;
    await scheduler.tick(); // C posts
    const cTweet = ctx(C).lastPostedTweetId!;
    expect(cTweet).not.toBe(anchor);

    now += 65_000;
    due(C, -100);
    await scheduler.tick(); // A again: must reply to `anchor`
    const last = post.mock.calls.at(-1)![1] as PostOpts;
    expect(last.replyToTweetId).toBe(anchor);
    expect(last.replyToTweetId).not.toBe(cTweet);
  });

  it('a live post of one campaign never delays a simulated campaign (spacing is for X only)', async () => {
    await scheduler.tick(); // A live, then B simulated in the same tick, C waits for spacing
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls.map((c) => c[2])).toEqual([false, true]);
    expect(ctx(C).stats?.totalPosts).toBe(0);
  });

  it('a simulated (dry-run) campaign never sets the global live-post spacing or cooldown', async () => {
    due(A, -100);
    due(C, -100);
    const sinceLive = services.rateLimit.getTimeSinceLastLivePostMs();
    await scheduler.tick(); // only B (simulated quote)
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][2]).toBe(true);
    expect(services.rateLimit.getTimeSinceLastLivePostMs()).toBe(sinceLive);
    expect(ctx(B).stats?.simulatedPosts).toBe(1);
    expect(ctx(A).stats?.totalPosts).toBe(0);
  });

  it('the global 50 s live spacing (by design) delays, but never skips, the second live campaign', async () => {
    due(B, -100);
    await scheduler.tick();
    expect(post).toHaveBeenCalledTimes(1); // C waits for the next tick
    now += 20_000;
    await scheduler.tick();
    expect(post).toHaveBeenCalledTimes(1);
    now += 35_000;
    await scheduler.tick();
    expect(post).toHaveBeenCalledTimes(2);
    expect(callsFor('3000')).toHaveLength(1);
  });

  it('a per-tick cap fires the longest-waiting campaign first, not the first in the list', async () => {
    due(A, 10);
    due(C, 300);
    due(B, -100);
    await scheduler.tick({ maxDrops: 1 });
    expect(post).toHaveBeenCalledTimes(1);
    expect((post.mock.calls[0][1] as PostOpts).replyToTweetId).toBe('3000');
  });
});

describe('errors, back-off and auto-pause stay with the failing campaign', () => {
  it('an X 401 auto-pauses only that campaign; the others keep their state', async () => {
    due(A, -100);
    due(B, -100);
    const before = { a: snapshot(A), b: snapshot(B) };
    post.mockImplementation(failWith(401) as never);
    await scheduler.tick(); // C fails
    expect(ctx(C).enabled).toBe(false);
    expect(ctx(C).autoPausedReason).toMatch(/401/);
    expect(snapshot(A)).toEqual(before.a);
    expect(snapshot(B)).toEqual(before.b);
  });

  it('the 15-minute error back-off moves only the failing 1-minute campaign clock', async () => {
    post.mockImplementation(failWith(400) as never); // persistent (not a transient 5xx)
    due(C, -100);
    const cBefore = ctx(C).lastPostedTimestamp;
    await scheduler.tick(); // A fails
    expect(ctx(A).retry).toMatchObject({ at: now + 15 * MIN, transient: false });
    expect(scheduler.getNextScheduledPost(A)!.secondsUntil).toBe(15 * 60);
    expect(ctx(A).consecutiveErrors).toBe(1);
    expect(ctx(C).lastPostedTimestamp).toBe(cBefore);
    expect(ctx(C).consecutiveErrors ?? 0).toBe(0);
    expect(scheduler.getNextScheduledPost(C)!.secondsUntil).toBe(100); // not 15 minutes
  });

  it('a failed post never moves or clears the chain anchor', async () => {
    await scheduler.tick(); // A posts, anchor set
    const anchor = snapshot(A).chainAnchor;
    now += 65_000;
    post.mockImplementation(failWith(500) as never);
    due(C, -100);
    await scheduler.tick(); // A fails
    expect(ctx(A).chainAnchor).toEqual(anchor);
    expect(ctx(A).lastPostedTweetId).toBe(anchor.tweetId);
  });

  it("a 429 sets the account's cooldown and blocks every campaign on that account", async () => {
    due(B, -100);
    post.mockImplementation(failWith(429, 'Too Many Requests') as never);
    await scheduler.tick(); // A hits the limit
    expect(services.rateLimit.getCooldownState().isThrottled).toBe(true);
    // All three campaigns post as the default account, so they all wait.
    expect(scheduler.getBlockedReason(ctx(C))).toMatch(/cooldown/);
    post.mockImplementation(okPost as never);
    await scheduler.tick();
    expect(post).toHaveBeenCalledTimes(1); // C blocked by the account cooldown (B is not due)
    expect(ctx(A).consecutiveErrors ?? 0).toBe(0); // throttling is not a breaker error
  });
});

describe('history, hashtags, queue', () => {
  it("clearing one campaign's history leaves the others' logs, stats and anchors alone", async () => {
    await scheduler.tick();
    now += 55_000;
    await scheduler.tick();
    const cBefore = snapshot(C);
    const aAnchor = snapshot(A).chainAnchor;
    const { clearedCount } = services.logs.clearContextHistory(A);
    expect(clearedCount).toBe(1);
    const logs = services.logs.getLogs();
    expect(logs.some((l) => l.contextId === A)).toBe(false);
    expect(logs.filter((l) => l.contextId === C)).toHaveLength(1);
    expect(logs.filter((l) => l.contextId === B)).toHaveLength(1);
    expect(snapshot(C)).toEqual(cBefore);
    expect(ctx(A).stats?.totalPosts).toBe(0);
    expect(ctx(A).chainAnchor).toEqual(aAnchor); // history cleanup is not a chain reset
  });

  it('evolving hashtags advance only on the campaign that evolves them', async () => {
    await scheduler.tick();
    now += 55_000;
    await scheduler.tick();
    expect(ctx(A).hashtagState?.current.length).toBeGreaterThan(0);
    expect(ctx(B).hashtagState).toBeUndefined();
    expect(ctx(C).hashtagState).toBeUndefined();
    const cText = (callsFor('3000')[0][1] as PostOpts).text;
    expect(cText).not.toMatch(/#/);
  });

  it("a drop consumes a slot from its own queue only; regenerating one queue keeps the others'", async () => {
    due(B, -100);
    const bSlots = services.queue.getQueue(B).map((s) => s.slotId);
    await scheduler.tick(); // A consumes one of its own slots (and tops up)
    expect(services.queue.getQueue(B).map((s) => s.slotId)).toEqual(bSlots);
    services.queue.clearAndRegenerateQueue(A);
    expect(services.queue.getQueue(B).map((s) => s.slotId)).toEqual(bSlots);
    expect(services.queue.getQueue(A).every((s) => s.contextId === A)).toBe(true);
    expect(services.queue.getQueue(A).every((s) => (s.previewText ?? '').startsWith('A '))).toBe(
      true,
    );
  });
});

describe('chain continuity across log trimming, restarts and legacy data', () => {
  it("B posting hundreds of times (MAX_LOGS) never resets paused A's chain", async () => {
    await scheduler.tick(); // A anchors
    const anchor = ctx(A).lastPostedTweetId!;
    services.contexts.patchContext(A, { enabled: false });
    process.env.MAX_LOGS = '3';
    try {
      for (let i = 0; i < 6; i++) {
        due(B, 0);
        await scheduler.tick();
      }
    } finally {
      delete process.env.MAX_LOGS;
    }
    expect(services.logs.getLogs().some((l) => l.tweetId === anchor)).toBe(false);
    services.contexts.patchContext(A, { enabled: true });
    expect(services.contexts.getEffectiveReplyTargetId(ctx(A)).targetTweetId).toBe(anchor);
  });

  it('a cold start from the persisted campaigns (with trimmed logs) keeps the anchor', async () => {
    await scheduler.tick();
    const anchor = ctx(A).lastPostedTweetId!;
    const svc = await createServices(
      new MemoryStore({
        contexts: JSON.parse(JSON.stringify(services.contexts.getContexts())),
        activeContextId: A,
        logs: [], // every log aged out
      }),
    );
    const a = svc.contexts.getContext(A)!;
    expect(svc.contexts.getEffectiveReplyTargetId(a).targetTweetId).toBe(anchor);
  });

  it('a legacy / imported anchor without provenance is only kept when a log proves it', async () => {
    const base = JSON.parse(JSON.stringify(ctx(A)));
    const proven = { ...base, id: 'ctx_p', lastPostedTweetId: '7', chainAnchor: undefined };
    const stolen = { ...base, id: 'ctx_s', lastPostedTweetId: '8', chainAnchor: undefined };
    const unproven = { ...base, id: 'ctx_u', lastPostedTweetId: '9', chainAnchor: undefined };
    const log = (over: object) => ({
      id: `l_${Math.random()}`,
      timestamp: new Date().toISOString(),
      status: 'success',
      engagementMode: 'reply',
      targetTweetId: '1000',
      ...over,
    });
    const svc = await createServices(
      new MemoryStore({
        contexts: [proven, stolen, unproven],
        activeContextId: 'ctx_p',
        logs: [
          log({ tweetId: '7', contextId: 'ctx_p' }),
          log({ tweetId: '8', contextId: 'ctx_other' }),
        ],
      } as never),
    );
    expect(svc.contexts.getContext('ctx_p')!.chainAnchor).toMatchObject({ tweetId: '7' });
    expect(svc.contexts.getContext('ctx_s')!.lastPostedTweetId).toBeUndefined();
    expect(svc.contexts.getContext('ctx_u')!.lastPostedTweetId).toBeUndefined();
  });
});
