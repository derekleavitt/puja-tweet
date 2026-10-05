/**
 * Conversation turn composition: pure helpers, prompt text, summary and the Gemini-backed paths
 * (SDK stubbed, no network).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateColor } from '../../server/colorEngine.js';
import { getGeminiModels, resetGeminiCallCounter } from '../../server/geminiConfig.js';
import { weightedTweetLength } from '../../shared/tweetLength.js';
import type { ConversationState, PostLog, TweetContext } from '../../shared/types.js';

const generateContent = vi.fn();
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent: (...a: unknown[]) => generateContent(...a) };
  },
}));
vi.mock('../../server/services/index.js', () => ({ services: { logs: { getLogs: () => [] } } }));

const {
  pickNext,
  placeMentions,
  dehash,
  deMentionStrangers,
  buildTranscript,
  buildConversationPrompt,
  conversationBudget,
  shouldSummarize,
  buildSummaryPrompt,
} = await import('../../server/services/conversationTurn.js');
const { createConversationService } = await import('../../server/services/conversationService.js');
const { generateAgentText, resolveTemplateText, AgentUnavailableError } =
  await import('../../server/templateAgent.js');

const prevKey = process.env.GEMINI_API_KEY;
beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  process.env.GEMINI_API_KEY = 'test-key';
  delete process.env.GEMINI_MAX_CALLS_PER_DAY;
  process.env.GEMINI_BUSY_RETRY_MS = '0';
  resetGeminiCallCounter();
  generateContent.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
  delete process.env.GEMINI_BUSY_RETRY_MS;
  if (prevKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = prevKey;
  vi.restoreAllMocks();
});

describe('pickNext', () => {
  it('never repeats the speaker and alternates with two participants', () => {
    for (let i = 0; i < 50; i++) expect(pickNext('a', ['a', 'b', 'c'])).not.toBe('a');
    expect(pickNext('a', ['a', 'b'])).toBe('b');
    expect(pickNext('b', ['a', 'b'])).toBe('a');
  });

  it('covers every other participant', () => {
    const seen = new Set<string>();
    for (const r of [0, 0.3, 0.6, 0.99]) seen.add(pickNext('a', ['a', 'b', 'c', 'd'], () => r));
    expect(seen).toEqual(new Set(['b', 'c', 'd']));
    expect(pickNext('a', ['a', 'b', 'c'], () => 1)).toBe('c');
  });
});

describe('placeMentions', () => {
  const rules = {
    required: ['thebeethovenjr', 'bhaijahndai'],
    speaker: 'bhalomachiato',
    maxLength: 280,
  };

  it('turns a dangling vocative plus "cc" into one natural group at the end', () => {
    const raw =
      'Faith keeps me wading through the currents. Perhaps we simply need to sacrifice a few more ' +
      'flies to the river gods, @thebeethovenjr.';
    expect(placeMentions(raw, rules)).toBe(
      'Faith keeps me wading through the currents. Perhaps we simply need to sacrifice a few more ' +
        'flies to the river gods. @thebeethovenjr @bhaijahndai',
    );
    expect(placeMentions(raw, rules)).not.toContain('cc');
  });

  it('keeps a group the model put at the start, and adds whoever is missing to it', () => {
    expect(placeMentions('@thebeethovenjr, the trout disagree.', rules)).toBe(
      '@thebeethovenjr @bhaijahndai the trout disagree.',
    );
  });

  it('merges "@a and @b" at the end and keeps the question mark', () => {
    expect(placeMentions('What say you, @bhaijahndai and @thebeethovenjr?', rules)).toBe(
      'What say you? @bhaijahndai @thebeethovenjr',
    );
  });

  it('leaves mentions inside sentences (a remark for each person) where they are', () => {
    const t = '@thebeethovenjr is wrong about lures, and @bhaijahndai is wrong about everything.';
    expect(placeMentions(t, rules)).toBe(t);
    expect(placeMentions('I agree with @bhaijahndai on this.', rules)).toBe(
      'I agree with @bhaijahndai on this. @thebeethovenjr',
    );
  });

  it('never tags the speaker, matches handles case-insensitively and keeps canonical case', () => {
    expect(placeMentions('Indeed. @BhaloMachiato @THEBEETHOVENJR', rules)).toBe(
      'Indeed. @thebeethovenjr @bhaijahndai',
    );
  });

  it('trims the text (not the mentions) to fit the budget, on a complete sentence', () => {
    const long = `${'A fine sentence about trout. '.repeat(20)}`.trim();
    const out = placeMentions(long, { ...rules, maxLength: 200 });
    expect(weightedTweetLength(out)).toBeLessThanOrEqual(200);
    expect(out.endsWith(' @thebeethovenjr @bhaijahndai')).toBe(true);
    expect(out.replace(/ @\w+/g, '')).toMatch(/[.!?…]$/);
  });
});

describe('dehash / conversationBudget', () => {
  it('turns hashtags the model wrote into plain words', () => {
    expect(dehash('Sing the #RiverGods song now.')).toBe('Sing the RiverGods song now.');
    expect(dehash('Cast again. @bob #fishing #trout')).toBe('Cast again. @bob');
    expect(dehash('Q&A #1 at C#')).toBe('Q&A 1 at C#');
  });

  it('reserves room for every mention and the hashtag block', () => {
    const handles = ['aaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbb', 'ccccccccccccccc', 'ddddddddddddddd'];
    const max = conversationBudget(handles, 30);
    expect(max).toBe(280 - 4 * 17 - 30);
    expect(conversationBudget(['bob'])).toBe(240);
  });
});

describe('deMentionStrangers', () => {
  it('also de-mentions the fullwidth at-sign X treats as a mention', () => {
    expect(deMentionStrangers('hello \uFF20victim and \uFF20alice', ['alice'])).toBe(
      'hello victim and \uFF20alice',
    );
  });

  it('removes @ from strangers but keeps participants and the opener', () => {
    const out = deMentionStrangers('@Alice hi @foo and @opener, ask @BOB. mail a@b.c', [
      'alice',
      'bob',
      'opener',
    ]);
    expect(out).toBe('@Alice hi foo and @opener, ask @BOB. mail a@b.c');
  });
});

const log = (o: Partial<PostLog>): PostLog =>
  ({
    id: Math.random().toString(),
    timestamp: '2026-01-01T00:00:00.000Z',
    slotType: 'manual',
    targetTweetId: '1',
    color: generateColor('morning'),
    tweetText: 't',
    status: 'success',
    contextId: 'c1',
    conversationRunId: 'r1',
    accountHandle: 'a',
    ...o,
  }) as PostLog;

describe('buildTranscript', () => {
  it('filters by context, run and status and orders chronologically', () => {
    const logs = [
      log({ turn: 3, tweetText: 'three', accountHandle: 'a' }),
      log({ turn: 2, tweetText: 'two', accountHandle: 'b', status: 'simulated' }),
      log({ turn: 1, tweetText: 'one', accountHandle: 'a' }),
      log({ turn: 4, tweetText: 'failed', status: 'error' }),
      log({ turn: 4, tweetText: 'other run', conversationRunId: 'r2' }),
      log({ turn: 4, tweetText: 'other ctx', contextId: 'c2' }),
    ];
    expect(buildTranscript(logs, 'c1', 'r1')).toEqual([
      { turn: 1, handle: 'a', text: 'one' },
      { turn: 2, handle: 'b', text: 'two' },
      { turn: 3, handle: 'a', text: 'three' },
    ]);
  });
});

describe('prompt', () => {
  const base = {
    sharedPrompt: 'Two poets argue.',
    persona: 'Wry and warm.',
    speakerHandle: 'a',
    otherHandles: ['b', 'c'],
    openerHandle: 'owner',
    openingPost: 'Hey @a @b, begin.',
    transcript: [
      { turn: 7, handle: 'a', text: 'seven' },
      { turn: 8, handle: 'b', text: 'eight' },
    ],
    turnNumber: 9,
    nextHandle: 'c',
    max: 237,
  };

  it('contains every section of the spec', () => {
    const { systemInstruction, contents } = buildConversationPrompt({
      ...base,
      summary: 'They met.',
      summaryThroughTurn: 6,
    });
    expect(systemInstruction).toContain('Strictly under 237 characters.');
    expect(systemInstruction).toContain('You speak as exactly one of them.');
    expect(contents).toContain('SHARED PREMISE AND TONE:\nTwo poets argue.');
    expect(contents).toContain('YOUR CHARACTER (you are @a):\nWry and warm.');
    expect(contents).toContain('You are @a, talking with @b, @c, in a thread opened by @owner.');
    expect(contents).toContain('OPENING POST by @owner:\n"Hey @a @b, begin."');
    expect(contents).toContain('EARLIER IN THE CONVERSATION (summary of turns 1–6):\nThey met.');
    expect(contents).toContain(
      'CONVERSATION SO FAR (oldest first):\n[Turn 7] @a: "seven"\n[Turn 8] @b: "eight"',
    );
    expect(contents).toContain('WRITE TURN 9 AS @a. @c answers next');
    expect(contents).toContain('tag @b, @c together at the start or the end (not "cc")');
    expect(systemInstruction).toContain('never "cc"');
    expect(contents).toContain('under 237 characters, complete sentences.');
  });

  it('handles an empty transcript, no summary and no opener', () => {
    const { contents } = buildConversationPrompt({
      ...base,
      transcript: [],
      openerHandle: undefined,
    });
    expect(contents).not.toContain('EARLIER IN THE CONVERSATION');
    expect(contents).toContain('No one has replied yet; you reply to the opening post.');
    expect(contents).toContain('talking with @b, @c.');
    expect(contents).toContain('OPENING POST:\n');
  });

  it('summary prompt carries the old summary and the turns', () => {
    const { contents } = buildSummaryPrompt('old', [{ turn: 1, handle: 'a', text: 'hi' }]);
    expect(contents).toContain('PREVIOUS SUMMARY:\nold');
    expect(contents).toContain('[Turn 1] @a: "hi"');
  });
});

describe('shouldSummarize', () => {
  it('triggers only past 20 unsummarised turns', () => {
    expect(shouldSummarize({ turnCount: 20 })).toBe(false);
    expect(shouldSummarize({ turnCount: 21 })).toBe(true);
    expect(shouldSummarize({ turnCount: 30, summaryThroughTurn: 10 })).toBe(false);
    expect(shouldSummarize({ turnCount: 31, summaryThroughTurn: 10 })).toBe(true);
  });
});

describe('buildTurn', () => {
  const handles: Record<string, string> = { acct_a: 'alice', acct_b: 'bob', acct_c: 'cy' };
  const makeCtx = (turnCount: number, extra: Partial<TweetContext> = {}): TweetContext =>
    ({
      id: 'c1',
      name: 'Talk',
      mode: 'conversation',
      targetTweetId: '500',
      conversation: {
        participants: [
          { accountId: 'acct_a', persona: 'Alice persona' },
          { accountId: 'acct_b', persona: 'Bob persona' },
          { accountId: 'acct_c', persona: 'Cy persona' },
        ],
        sharedPrompt: 'Shared',
        openingPost: 'Hi @alice',
        openerHandle: 'owner',
      },
      conversationState: { runId: 'r1', turnCount, nextSpeakerAccountId: 'acct_a' },
      ...extra,
    }) as TweetContext;
  const turnsLogs = (n: number): PostLog[] =>
    Array.from({ length: n }, (_, i) =>
      log({ turn: i + 1, tweetText: `turn ${i + 1}`, accountHandle: 'alice' }),
    ).reverse();
  const makeSvc = (ctx: TweetContext, logs: PostLog[], generate = vi.fn()) => {
    const svc = createConversationService({
      accounts: { handleOf: (id) => (id ? handles[id] : undefined) },
      contexts: {
        getContext: () => ctx,
        getEffectiveReplyTargetId: (c) => ({
          targetTweetId: c.lastPostedTweetId ?? c.targetTweetId,
        }),
      },
      logs: { getLogs: () => logs },
      generate,
      rng: () => 0,
    });
    return { svc, generate };
  };

  it('composes a turn with mention, de-@d strangers and reply target', async () => {
    const ctx = makeCtx(2, { lastPostedTweetId: '777' });
    const { svc, generate } = makeSvc(ctx, turnsLogs(2));
    generate.mockResolvedValue('Hello @owner and @stranger.');
    const turn = await svc.buildTurn(ctx);
    expect(turn).toMatchObject({
      runId: 'r1',
      turnNumber: 3,
      speakerAccountId: 'acct_a',
      speakerHandle: 'alice',
      nextSpeakerAccountId: 'acct_b',
      nextSpeakerHandle: 'bob',
      replyToTweetId: '777',
      summaryUsed: false,
      transcriptLength: 2,
    });
    // The next speaker is addressed, and every other participant is tagged so anyone can reply.
    expect(turn.text).toBe('Hello @owner and stranger. @bob @cy');
    expect(generate.mock.calls[0][0]).toContain('[Turn 2] @alice: "turn 2"');
  });

  it('appends evolved hashtags (reserving their room) and reports them', async () => {
    const ctx = makeCtx(2, {
      hashtags: ['FlyFishing'],
      hashtagEvolution: { enabled: true, maxTags: 2, keepSeedTags: false },
    });
    const next = vi.fn().mockResolvedValue({ tags: ['TroutTalk', 'RiverGods'], source: 'gemini' });
    const generate = vi.fn().mockResolvedValue('The river owes us nothing, @bob. #fishing');
    const svc = createConversationService({
      accounts: { handleOf: (id) => (id ? handles[id] : undefined) },
      contexts: {
        getContext: () => ctx,
        getEffectiveReplyTargetId: (c) => ({ targetTweetId: c.targetTweetId }),
      },
      logs: { getLogs: () => turnsLogs(2) },
      generate,
      hashtags: { next },
      rng: () => 0,
    });
    const turn = await svc.buildTurn(ctx);
    expect(turn.text).toBe('The river owes us nothing. @bob @cy #TroutTalk #RiverGods');
    expect(turn.hashtags).toEqual(['TroutTalk', 'RiverGods']);
    // Seeded from the campaign's own tags and steered by the conversation's topic.
    expect(next.mock.calls[0][2]).toMatchObject({ hashtags: ['FlyFishing'] });
    expect(next.mock.calls[0][2].topic).toContain('Shared');
    expect(next.mock.calls[0][2].topic).toContain('turn 2');
    // The model's budget leaves room for the mentions and the tag block.
    const room = 280 - ' @bob @cy'.length - ' #TroutTalk #RiverGods'.length;
    expect(generate.mock.calls[0][1].maxLength).toBe(Math.min(240, room));
  });

  it('uses the campaign hashtags as-is when evolution is off', async () => {
    const ctx = makeCtx(2, { hashtags: ['FlyFishing'] });
    const { svc, generate } = makeSvc(ctx, turnsLogs(2));
    generate.mockResolvedValue('Cast again.');
    const turn = await svc.buildTurn(ctx);
    expect(turn.text).toBe('Cast again. @bob @cy #FlyFishing');
    expect(turn.hashtags).toBeUndefined();
  });

  it('previewing a turn leaves the campaign unchanged (no turn buffer is stored)', async () => {
    const ctx = makeCtx(2);
    const before = JSON.stringify(ctx);
    const { svc, generate } = makeSvc(ctx, turnsLogs(2));
    generate.mockResolvedValue('Hello.');
    const turn = await svc.buildTurn(ctx);
    expect(turn.transcriptLength).toBe(2);
    expect(JSON.stringify(ctx)).toBe(before);
  });

  it('rejects an unverified participant handle with 400', async () => {
    const ctx = makeCtx(0);
    delete handles.acct_c;
    try {
      const { svc } = makeSvc(ctx, []);
      await expect(svc.buildTurn(ctx)).rejects.toMatchObject({ status: 400 });
    } finally {
      handles.acct_c = 'cy';
    }
  });

  it('summarises past 20 turns, keeps the last 15 verbatim and persists the summary', async () => {
    const ctx = makeCtx(25);
    const { svc, generate } = makeSvc(ctx, turnsLogs(25));
    generate.mockResolvedValueOnce('The gist.').mockResolvedValueOnce('Reply.');
    const turn = await svc.buildTurn(ctx);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[0][0]).toContain('[Turn 10] @alice');
    expect(generate.mock.calls[0][0]).not.toContain('[Turn 11]');
    expect(ctx.conversationState).toMatchObject({ summary: 'The gist.', summaryThroughTurn: 10 });
    const prompt = generate.mock.calls[1][0] as string;
    expect(prompt).toContain('summary of turns 1–10');
    expect(prompt).toContain('[Turn 11] @alice');
    expect(prompt).not.toContain('[Turn 10] @alice');
    expect(turn.summaryUsed).toBe(true);
  });

  it('keeps the old summary when the summary call fails', async () => {
    const ctx = makeCtx(30);
    ctx.conversationState = { ...ctx.conversationState!, summary: 'old', summaryThroughTurn: 5 };
    const { svc, generate } = makeSvc(ctx, turnsLogs(30));
    generate.mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce('Reply.');
    const turn = await svc.buildTurn(ctx);
    expect(ctx.conversationState.summary).toBe('old');
    expect(ctx.conversationState.summaryThroughTurn).toBe(5);
    expect(turn.summaryUsed).toBe(true);
    expect(generate.mock.calls[1][0]).toContain('summary of turns 1–5');
  });
});

describe('generateAgentText', () => {
  const opts = { systemInstruction: 'sys', maxLength: 100 };

  it('returns cleaned text from the model', async () => {
    generateContent.mockResolvedValueOnce({ text: '"Short and sweet."' });
    await expect(generateAgentText('hi', opts)).resolves.toBe('Short and sweet.');
    expect(generateContent.mock.calls[0][0].config.systemInstruction).toBe('sys');
  });

  it('throws AgentUnavailableError when not configured or every model fails', async () => {
    generateContent.mockRejectedValue(new Error('boom'));
    await expect(generateAgentText('hi', opts)).rejects.toBeInstanceOf(AgentUnavailableError);
    expect(generateContent).toHaveBeenCalledTimes(getGeminiModels().length);
    delete process.env.GEMINI_API_KEY;
    await expect(generateAgentText('hi', opts)).rejects.toBeInstanceOf(AgentUnavailableError);
  });

  it('waits and retries every model once when they are all busy (503/429)', async () => {
    process.env.GEMINI_BUSY_RETRY_MS = '0';
    const busy = new Error('{"error":{"code":503,"message":"high demand","status":"UNAVAILABLE"}}');
    const models = getGeminiModels().length;
    for (let i = 0; i < models; i++) generateContent.mockRejectedValueOnce(busy);
    generateContent.mockResolvedValueOnce({ text: 'Back again.' });
    await expect(generateAgentText('hi', opts)).resolves.toBe('Back again.');
    expect(generateContent).toHaveBeenCalledTimes(models + 1);
  });

  it('gives up after the retry pass when the models stay busy', async () => {
    process.env.GEMINI_BUSY_RETRY_MS = '0';
    generateContent.mockRejectedValue(new Error('429 RESOURCE_EXHAUSTED'));
    const err = await generateAgentText('hi', opts).catch((e: Error) => e);
    expect(err).toBeInstanceOf(AgentUnavailableError);
    const models = getGeminiModels().length;
    expect(generateContent).toHaveBeenCalledTimes(models * 2);
    expect((err as Error).message.match(/RESOURCE_EXHAUSTED/g)).toHaveLength(models);
  });

  it('retries every model once, without waiting, after a timeout', async () => {
    process.env.GEMINI_BUSY_RETRY_MS = '60000'; // would time the test out if it waited
    const aborted = Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
    const models = getGeminiModels().length;
    for (let i = 0; i < models; i++) generateContent.mockRejectedValueOnce(aborted);
    generateContent.mockResolvedValueOnce({ text: 'Made it.' });
    await expect(generateAgentText('hi', opts)).resolves.toBe('Made it.');
    expect(generateContent).toHaveBeenCalledTimes(models + 1);
  });

  it('says how long it waited when a model keeps timing out', async () => {
    vi.stubEnv('GEMINI_MODEL', 'model-a');
    vi.stubEnv('GEMINI_TIMEOUT_MS', '12000');
    const aborted = Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
    generateContent.mockRejectedValue(aborted);
    const err = await generateAgentText('hi', opts).catch((e: Error) => e);
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect((err as Error).message).toBe(
      'AI generation failed for every configured model (model-a: timed out after 12s).',
    );
  });

  it('does not retry errors that are not "busy"', async () => {
    process.env.GEMINI_BUSY_RETRY_MS = '0';
    generateContent.mockRejectedValue(new Error('models/x is not found'));
    await expect(generateAgentText('hi', opts)).rejects.toBeInstanceOf(AgentUnavailableError);
    expect(generateContent).toHaveBeenCalledTimes(getGeminiModels().length);
  });

  it('names each model and its reason (without API keys) when every model fails', async () => {
    vi.stubEnv('GEMINI_MODEL', 'model-a');
    vi.stubEnv('GEMINI_FALLBACK_MODEL', 'model-b');
    generateContent
      .mockRejectedValueOnce(
        new Error(
          '{"error":{"code":404,"message":"models/x is not found for API version v1beta"}}',
        ),
      )
      .mockRejectedValue(new Error('API key not valid. key=AIzaSECRET123 please pass a valid key'));
    const err = await generateAgentText('hi', opts).catch((e: Error) => e);
    expect(err).toBeInstanceOf(AgentUnavailableError);
    expect((err as Error).message).toMatch(/is not found for API version/);
    expect((err as Error).message).toMatch(/API key not valid/);
    expect((err as Error).message).not.toContain('SECRET123');
    expect((err as Error).message).toMatch(/model-a: .*; model-b: /);
  });

  it('buildTurn surfaces Gemini being down as a 503', async () => {
    delete process.env.GEMINI_API_KEY;
    const ctx = {
      id: 'c1',
      name: 'T',
      mode: 'conversation',
      targetTweetId: '1',
      conversation: {
        participants: [
          { accountId: 'x', persona: 'p' },
          { accountId: 'y', persona: 'q' },
        ],
        sharedPrompt: '',
        openingPost: '',
      },
      conversationState: { runId: 'r', turnCount: 0, nextSpeakerAccountId: 'x' },
    } as unknown as TweetContext;
    const svc = createConversationService({
      accounts: { handleOf: (id) => `h_${id}` },
      contexts: {
        getContext: () => ctx,
        getEffectiveReplyTargetId: () => ({ targetTweetId: '1' }),
      },
      logs: { getLogs: () => [] },
    });
    await expect(svc.buildTurn(ctx)).rejects.toMatchObject({ status: 503 });
  });
});

describe('poetry path is unchanged', () => {
  it('falls back to the color mood for color templates when Gemini is down', async () => {
    const color = { ...generateColor('morning'), colorPick: 'Amber' };
    delete process.env.GEMINI_API_KEY;
    await expect(resolveTemplateText('<agent>poem {hex}</agent>', color)).resolves.toBe(
      `${color.colorPick} (${color.hex}) — ${color.mood}`,
    );
  });

  it('throws for AI-only templates when Gemini is down', async () => {
    const color = generateColor('morning');
    generateContent.mockRejectedValue(new Error('boom'));
    await expect(
      resolveTemplateText('<agent>a poem about love</agent>', color),
    ).rejects.toBeInstanceOf(AgentUnavailableError);
  });
});

describe('appendTurnRecord (summary + buffer cover every turn)', () => {
  const rec = (turn: number) => ({
    turn,
    accountId: 'a',
    handle: 'alice',
    text: `turn ${turn} ${'x'.repeat(400)}`,
    at: '2026-01-01T00:00:00.000Z',
  });

  it('drops covered turns, clips text and folds the overflow past the cap without AI', async () => {
    const { appendTurnRecord, TURN_BUFFER_MAX, STORED_TEXT_MAX, SUMMARY_MAX_LENGTH } =
      await import('../../server/services/conversationTurn.js');
    const state: ConversationState = { runId: 'r', turnCount: 0, nextSpeakerAccountId: 'a' };
    for (let t = 1; t <= TURN_BUFFER_MAX + 5; t++) {
      appendTurnRecord(state, rec(t));
      state.turnCount = t;
      const through = state.summaryThroughTurn ?? 0;
      expect(state.turns!.map((x) => x.turn)).toEqual(
        Array.from({ length: t - through }, (_, i) => through + 1 + i),
      );
    }
    expect(state.turns).toHaveLength(TURN_BUFFER_MAX);
    expect(state.summaryThroughTurn).toBe(5);
    expect(state.summary).toContain('@alice: turn 5');
    expect(state.summary!.length).toBeLessThanOrEqual(SUMMARY_MAX_LENGTH);
    expect(state.turns![0].text.length).toBeLessThanOrEqual(STORED_TEXT_MAX);

    // A summary that moved ahead drops the covered turns on the next append; duplicates replace.
    state.summaryThroughTurn = 30;
    appendTurnRecord(state, rec(45));
    expect(state.turns!.map((x) => x.turn)).toEqual(Array.from({ length: 15 }, (_, i) => 31 + i));
  });
});
