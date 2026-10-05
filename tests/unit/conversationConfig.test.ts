import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServices, type Services } from '../../server/services/index.js';
import { MemoryStore } from '../../server/store/MemoryStore.js';
import { oauth1AccessToken, oauth1RequestToken } from '../../server/twitterClient.js';
import type { ConversationConfig, TweetContext } from '../../shared/types.js';

vi.mock('../../server/twitterClient.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../server/twitterClient.js')>()),
  oauth1RequestToken: vi.fn(),
  oauth1AccessToken: vi.fn(),
}));

const TARGET = '1700000000000000001';
const OTHER_TARGET = '1700000000000000002';
let svc: Services;
let a: string;
let b: string;
let c: string;

/** Connects an X user through the (mocked) PIN flow; returns its account id. */
const connectAccount = async (userId: string, handle: string) => {
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

const config = (over: Partial<ConversationConfig> = {}): ConversationConfig => ({
  participants: [
    { accountId: a, persona: 'Warm' },
    { accountId: b, persona: 'Dry' },
    { accountId: c, persona: 'Wild' },
  ],
  sharedPrompt: 'Debate tea vs coffee',
  openingPost: 'Hey @bob and @carol, tea or coffee?',
  openerHandle: 'alice',
  ...over,
});

const create = (
  over: Partial<ConversationConfig> = {},
  extra: Partial<Parameters<Services['contexts']['createContext']>[0]> = {},
) =>
  svc.contexts.createContext({
    name: 'Chat',
    targetTweetId: TARGET,
    mode: 'conversation',
    conversation: config(over),
    ...extra,
  });

const turn = (ctx: TweetContext, next: string) => ({
  runId: ctx.conversationState!.runId,
  turnNumber: ctx.conversationState!.turnCount + 1,
  nextSpeakerAccountId: next,
});

const fails = (fn: () => unknown, message: RegExp) => {
  try {
    fn();
  } catch (e) {
    expect((e as { status?: number }).status).toBe(400);
    expect((e as Error).message).toMatch(message);
    return;
  }
  throw new Error('expected a 400');
};

beforeEach(async () => {
  vi.stubEnv('TWITTER_API_KEY', 'consumer-key');
  vi.stubEnv('TWITTER_API_SECRET', 'consumer-secret');
  vi.stubEnv('X_HANDLE', '');
  vi.stubEnv('CREDENTIALS_ENCRYPTION_KEY', 'c'.repeat(64));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  svc = await createServices(new MemoryStore());
  a = await connectAccount('111', 'alice');
  b = await connectAccount('222', 'bob');
  c = await connectAccount('333', 'carol');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('conversation config validation', () => {
  it('rejects 1 and 6 participants', () => {
    fails(
      () => create({ participants: [{ accountId: a, persona: 'x' }], openingPost: '@alice hi' }),
      /2 to 5 participants/,
    );
    const ctx = create();
    const six = Array.from({ length: 6 }, () => ({ accountId: a, persona: 'x' }));
    fails(
      () => svc.contexts.updateContext(ctx.id, { conversation: config({ participants: six }) }),
      /2 to 5/,
    );
  });

  it('rejects a duplicate accountId', () => {
    fails(
      () =>
        create({
          participants: [
            { accountId: b, persona: 'x' },
            { accountId: b, persona: 'y' },
          ],
        }),
      /listed twice/,
    );
  });

  it('rejects an unknown account', () => {
    fails(
      () =>
        create({
          participants: [
            { accountId: b, persona: 'x' },
            { accountId: 'acct_nope', persona: 'y' },
          ],
        }),
      /Unknown X account/,
    );
  });

  it('rejects a participant without a known handle (unverified default account)', () => {
    fails(
      () =>
        create({
          participants: [
            { accountId: b, persona: 'x' },
            { accountId: 'acct_env', persona: 'y' },
          ],
        }),
      /Verify @handle first/,
    );
  });

  it('rejects a first speaker that is not a participant', () => {
    fails(() => create({ firstSpeakerAccountId: 'acct_zzz' }), /one of the participants/);
  });

  it('rejects a first speaker the opening post does not mention', () => {
    fails(
      () => create({ firstSpeakerAccountId: c, openingPost: 'Hey @bob, tea or coffee?' }),
      /must mention @carol/,
    );
  });

  it('rejects the opener as first speaker', () => {
    fails(
      () => create({ firstSpeakerAccountId: a, openingPost: 'Hi @alice @bob' }),
      /cannot also speak first/,
    );
  });

  it('applies the same rules on patch', () => {
    const ctx = create();
    fails(
      () =>
        svc.contexts.updateContext(ctx.id, {
          conversation: config({ firstSpeakerAccountId: c, openingPost: 'no mentions' }),
        }),
      /must mention @carol/,
    );
  });

  it('never accepts conversationState from a client', () => {
    const ctx = create();
    const runId = ctx.conversationState!.runId;
    const out = svc.contexts.updateContext(ctx.id, {
      conversationState: { runId: 'evil', turnCount: 99, nextSpeakerAccountId: a },
    });
    expect(out.conversationState?.runId).toBe(runId);
    expect(out.conversationState?.turnCount).toBe(0);
  });
});

describe('conversation create', () => {
  it('initialises state with a random first speaker among those mentioned', () => {
    for (let i = 0; i < 30; i++) {
      const ctx = create();
      expect(ctx.conversationState).toMatchObject({ turnCount: 0 });
      expect(ctx.conversationState!.runId).toMatch(/^run_\d+/);
      // @alice is the opener and not mentioned; only bob or carol can start.
      expect([b, c]).toContain(ctx.conversationState!.nextSpeakerAccountId);
    }
  });

  it('picks only the mentioned participant when one is mentioned', () => {
    for (let i = 0; i < 10; i++) {
      const ctx = create({ openingPost: 'Over to you @carol' });
      expect(ctx.conversationState!.nextSpeakerAccountId).toBe(c);
    }
  });

  it('uses the configured first speaker', () => {
    const ctx = create({ firstSpeakerAccountId: b });
    expect(ctx.conversationState!.nextSpeakerAccountId).toBe(b);
  });

  it('forces the single-account fields', () => {
    const ctx = create(
      {},
      {
        accountId: a,
        engagementMode: 'quote',
        replyTargetMode: 'original_post',
        autoFallbackToQuote: true,
        hashtags: ['Trout'],
        hashtagEvolution: { enabled: true },
      },
    );
    expect(ctx).toMatchObject({
      mode: 'conversation',
      accountId: undefined,
      engagementMode: 'reply',
      replyTargetMode: 'last_comment',
      autoFallbackToQuote: false,
      // Hashtags (and their evolution) work for conversations too.
      hashtags: ['Trout'],
    });
    expect(ctx.hashtagEvolution?.enabled).toBe(true);
    const patched = svc.contexts.patchContext(ctx.id, {
      engagementMode: 'quote',
      hashtags: ['RiverGods'],
      replyTargetMode: 'original_post',
    });
    expect(patched).toMatchObject({
      engagementMode: 'reply',
      replyTargetMode: 'last_comment',
      hashtags: ['RiverGods'],
    });
  });

  it('leaves single campaigns untouched', () => {
    const ctx = svc.contexts.createContext({ name: 'S', targetTweetId: TARGET });
    expect(ctx.mode).toBeUndefined();
    expect(ctx.conversationState).toBeUndefined();
  });
});

describe('recordConversationTurn', () => {
  it('advances the turn, sets the next speaker and keeps running', () => {
    const ctx = create({ firstSpeakerAccountId: b });
    const out = svc.contexts.recordConversationTurn(ctx.id, turn(ctx, c), 'success');
    expect(out.applied).toBe(true);
    const live = svc.contexts.getContext(ctx.id)!;
    expect(live.conversationState).toMatchObject({ turnCount: 1, nextSpeakerAccountId: c });
    expect(live.enabled).toBe(true);
    const sim = svc.contexts.recordConversationTurn(ctx.id, turn(live, b), 'simulated');
    expect(sim.applied).toBe(true);
    expect(live.conversationState).toMatchObject({ turnCount: 2, nextSpeakerAccountId: b });
  });

  it('pauses at maxTurns with the exact reason', () => {
    const ctx = create({ maxTurns: 2, firstSpeakerAccountId: b });
    svc.contexts.recordConversationTurn(ctx.id, turn(ctx, c), 'success');
    expect(ctx.enabled).toBe(true);
    svc.contexts.recordConversationTurn(ctx.id, turn(ctx, b), 'success');
    expect(ctx.enabled).toBe(false);
    expect(ctx.autoPausedReason).toBe('Conversation finished (2 turns)');
    expect(ctx.conversationState!.turnCount).toBe(2);
  });

  it('leaves the state alone on error', () => {
    const ctx = create({ firstSpeakerAccountId: b });
    const before = { ...ctx.conversationState! };
    const out = svc.contexts.recordConversationTurn(ctx.id, turn(ctx, c), 'error');
    expect(out.applied).toBe(false);
    expect(ctx.conversationState).toEqual(before);
  });

  it('ignores a stale runId or turn number', () => {
    const ctx = create({ firstSpeakerAccountId: b });
    const good = turn(ctx, c);
    const stale = { ...good, runId: 'run_old' };
    expect(svc.contexts.recordConversationTurn(ctx.id, stale, 'success').applied).toBe(false);
    const skipped = { ...good, turnNumber: 5 };
    expect(svc.contexts.recordConversationTurn(ctx.id, skipped, 'success').applied).toBe(false);
    expect(ctx.conversationState!.turnCount).toBe(0);
  });
});

describe('restartConversation', () => {
  it('starts a new run: anchor, turns and summary reset, finished reason cleared', () => {
    const ctx = create({ maxTurns: 1, firstSpeakerAccountId: b });
    svc.contexts.recordConversationTurn(ctx.id, turn(ctx, c), 'success');
    ctx.conversationState!.summary = 'old';
    ctx.conversationState!.summaryThroughTurn = 1;
    ctx.lastPostedTweetId = '123';
    ctx.chainAnchor = { tweetId: '123', targetTweetId: TARGET, postedAt: 'now' };
    const oldRun = ctx.conversationState!.runId;
    expect(ctx.autoPausedReason).toBe('Conversation finished (1 turns)');

    const out = svc.contexts.restartConversation(ctx.id, {
      targetTweetId: `https://x.com/alice/status/${OTHER_TARGET}`,
      openingPost: 'New topic @carol?',
      openerHandle: 'alice',
      firstSpeakerAccountId: c,
    });
    expect(out.targetTweetId).toBe(OTHER_TARGET);
    expect(out.conversation).toMatchObject({
      openingPost: 'New topic @carol?',
      firstSpeakerAccountId: c,
    });
    expect(out.conversationState).toMatchObject({ turnCount: 0, nextSpeakerAccountId: c });
    expect(out.conversationState!.summary).toBeUndefined();
    expect(out.conversationState!.runId).not.toBe(oldRun);
    expect(out.lastPostedTweetId).toBeUndefined();
    expect(out.chainAnchor).toBeUndefined();
    expect(out.autoPausedReason).toBeUndefined();
    expect(out.enabled).toBe(false); // left as is
  });

  it('validates like create and keeps a non-finished pause reason', () => {
    const ctx = create();
    ctx.autoPausedReason = '5 consecutive errors.';
    fails(
      () =>
        svc.contexts.restartConversation(ctx.id, {
          targetTweetId: OTHER_TARGET,
          openingPost: 'no mention',
          firstSpeakerAccountId: b,
        }),
      /must mention @bob/,
    );
    svc.contexts.restartConversation(ctx.id, {
      targetTweetId: OTHER_TARGET,
      openingPost: 'hi @bob',
    });
    expect(ctx.autoPausedReason).toBe('5 consecutive errors.');
  });

  it('refuses a single campaign', () => {
    const s = svc.contexts.createContext({ name: 'S', targetTweetId: TARGET });
    fails(
      () => svc.contexts.restartConversation(s.id, { targetTweetId: TARGET, openingPost: 'x' }),
      /not a conversation/,
    );
  });
});

describe('editing a conversation', () => {
  it('a new target starts a new run and resets the chain', () => {
    const ctx = create({ firstSpeakerAccountId: b });
    svc.contexts.recordConversationTurn(ctx.id, turn(ctx, c), 'success');
    ctx.lastPostedTweetId = '123';
    ctx.chainAnchor = { tweetId: '123', targetTweetId: TARGET, postedAt: 'now' };
    const oldRun = ctx.conversationState!.runId;
    const out = svc.contexts.updateContext(ctx.id, { targetTweetId: OTHER_TARGET });
    expect(out.conversationState!.runId).not.toBe(oldRun);
    expect(out.conversationState!.turnCount).toBe(0);
    expect(out.chainAnchor).toBeUndefined();
    expect(out.lastPostedTweetId).toBeUndefined();
  });

  it('a persona edit keeps state and chain', () => {
    const ctx = create({ firstSpeakerAccountId: b });
    svc.contexts.recordConversationTurn(ctx.id, turn(ctx, c), 'success');
    ctx.lastPostedTweetId = '123';
    ctx.chainAnchor = { tweetId: '123', targetTweetId: TARGET, postedAt: 'now' };
    const before = { ...ctx.conversationState! };
    const cfg = config({ firstSpeakerAccountId: b });
    cfg.participants[0].persona = 'Even warmer';
    const out = svc.contexts.updateContext(ctx.id, { conversation: cfg });
    expect(out.conversationState).toEqual(before);
    expect(out.chainAnchor?.tweetId).toBe('123');
    expect(out.conversation!.participants[0].persona).toBe('Even warmer');
  });

  it('ignores an account change (no chain reset)', () => {
    const ctx = create();
    ctx.lastPostedTweetId = '123';
    ctx.chainAnchor = { tweetId: '123', targetTweetId: TARGET, postedAt: 'now' };
    const out = svc.contexts.patchContext(ctx.id, { accountId: b });
    expect(out.accountId).toBeUndefined();
    expect(out.chainAnchor?.tweetId).toBe('123');
  });

  it('re-picks the next speaker when the cast drops them', () => {
    const ctx = create({ firstSpeakerAccountId: b });
    svc.contexts.recordConversationTurn(ctx.id, turn(ctx, c), 'success');
    const runId = ctx.conversationState!.runId;
    const out = svc.contexts.updateContext(ctx.id, {
      conversation: config({
        participants: [
          { accountId: a, persona: 'Warm' },
          { accountId: b, persona: 'Dry' },
        ],
        openingPost: 'Hey @bob',
      }),
    });
    expect([a, b]).toContain(out.conversationState!.nextSpeakerAccountId);
    expect(out.conversationState).toMatchObject({ runId, turnCount: 1 });
  });

  it('switching to conversation mode requires a config and starts a run', () => {
    const s = svc.contexts.createContext({ name: 'S', targetTweetId: TARGET });
    fails(() => svc.contexts.updateContext(s.id, { mode: 'conversation' }), /conversation setup/);
    const out = svc.contexts.updateContext(s.id, { mode: 'conversation', conversation: config() });
    expect(out.mode).toBe('conversation');
    expect(out.conversationState!.turnCount).toBe(0);
    expect(out.engagementMode).toBe('reply');
  });

  it('refuses to resume while a participant is removed', async () => {
    const ctx = create({}, { enabled: false });
    svc.accounts.remove(c);
    fails(() => svc.contexts.toggleContext(ctx.id), /Cannot resume/);
  });
});

describe('duplicateContext', () => {
  it('copies the setup with fresh state, paused', () => {
    const ctx = create({ firstSpeakerAccountId: b });
    svc.contexts.recordConversationTurn(ctx.id, turn(ctx, c), 'success');
    const copy = svc.contexts.duplicateContext(ctx.id);
    expect(copy.mode).toBe('conversation');
    expect(copy.enabled).toBe(false);
    expect(copy.conversation).toEqual(ctx.conversation);
    expect(copy.conversation).not.toBe(ctx.conversation);
    expect(copy.conversationState).toMatchObject({ turnCount: 0, nextSpeakerAccountId: b });
    expect(copy.conversationState!.runId).not.toBe(ctx.conversationState!.runId);
  });
});
