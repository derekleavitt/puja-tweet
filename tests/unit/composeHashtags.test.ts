/**
 * composeDropText end to end with the REAL template agent (Gemini SDK stubbed): AI hashtags,
 * campaign tags, evolution, length budget, preview == post, per-campaign state.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateColor } from '../../server/colorEngine.js';
import { resetGeminiCallCounter } from '../../server/geminiConfig.js';
import { MemoryStore } from '../../server/store/MemoryStore.js';
import { checkTweetText, weightedTweetLength } from '../../shared/tweetLength.js';
import type { TweetContext } from '../../shared/types.js';

const generateContent = vi.fn();
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent: (...a: unknown[]) => generateContent(...a) };
  },
}));
vi.mock('../../server/services/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../server/services/index.js')>()),
  services: { logs: { getLogs: () => [] } },
}));

const { createServices } = await import('../../server/services/index.js');
const { createDropService } = await import('../../server/services/dropService.js');
const { resolveTemplateText, AgentUnavailableError } =
  await import('../../server/templateAgent.js');
const { AGENT_NO_HASHTAGS_DIRECTIVE } = await import('../../server/services/dropText.js');

type Services = Awaited<ReturnType<typeof createServices>>;
let svc: Services;
const post = vi.fn();
const next = vi.fn();
const color = { ...generateColor('morning'), colorPick: 'Amber', weatherDesc: 'soft air' };
const prevKey = process.env.GEMINI_API_KEY;

const AI_ONLY = '<history><agent>Write a short poem about love and devotion</agent></history>';

const makeDrops = () =>
  createDropService({
    services: svc,
    postColorTweet: post as never,
    resolveTemplateText,
    hashtags: { next } as never,
  });

const campaign = (data: Partial<TweetContext> & Record<string, unknown>) =>
  svc.contexts.createContext({ targetTweetId: '111', dryRun: false, ...data } as never);
const evolving = (maxTags = 3, keepSeedTags = false) => ({
  hashtagEvolution: { enabled: true, maxTags, keepSeedTags },
});
const ai = (...texts: string[]) => {
  for (const text of texts) generateContent.mockResolvedValueOnce({ text });
};
const promptOf = (call = 0) => String(generateContent.mock.calls[call][0].contents);
const compose = (ctx: TweetContext) => makeDrops().composeText(ctx, color, { slotLabel: '6:00' });

beforeEach(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  process.env.GEMINI_API_KEY = 'test-key';
  delete process.env.GEMINI_MAX_CALLS_PER_DAY;
  resetGeminiCallCounter();
  generateContent.mockReset();
  svc = await createServices(new MemoryStore());
  svc.settings.updateSettings({ globalDryRun: false, globalPaused: false });
  post.mockReset().mockResolvedValue({ success: true, tweetId: '999', url: 'u' });
  next.mockReset().mockResolvedValue({ tags: ['Heart', 'Muse', 'Longing'], source: 'offline' });
});
afterEach(() => {
  if (prevKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = prevKey;
  vi.restoreAllMocks();
});

describe('AI hashtags with evolution ON', () => {
  it('tells the model not to write hashtags, lifts its trailing cluster and de-hashes inline tags', async () => {
    const ctx = campaign({ template: AI_ONLY, ...evolving() });
    ai('this #love burns. #Devotion #Poetry');
    const out = await compose(ctx);
    expect(promptOf()).toContain(AGENT_NO_HASHTAGS_DIRECTIVE);
    // Poetry (AI) replaces the last evolved tag; Devotion is longer than the room reserved.
    expect(out.text).toBe('this love burns. #Heart #Muse #Poetry');
    expect(out.hashtags).toEqual(['Heart', 'Muse', 'Poetry']);
    expect(out.breakdown).toEqual({
      body: 'this love burns.',
      staticText: '',
      aiText: 'this love burns.',
      tagBlock: '#Heart #Muse #Poetry',
      hashtags: ['Heart', 'Muse', 'Poetry'],
      tagSource: 'evolved',
      seedSource: 'ai',
      foldedAiTags: ['Poetry'],
      removedAiHashtags: ['Devotion', 'Poetry'],
      dehashedAiHashtags: ['love'],
    });
  });

  it('seeds an AI-only campaign from a neutral (non-color) theme of the prompt', async () => {
    const ctx = campaign({ template: AI_ONLY, ...evolving() });
    ai('A quiet vow.');
    const out = await compose(ctx);
    expect(next.mock.calls[0][2]).toMatchObject({ template: AI_ONLY, hashtags: [] });
    expect(out.breakdown.seedSource).toBe('theme');
    expect(promptOf()).not.toMatch(/Amber|#[0-9A-F]{6}/);
  });

  it('seeds from the campaign hashtags, else the previous evolved tags', async () => {
    const own = campaign({ template: AI_ONLY, hashtags: ['vows'], ...evolving() });
    ai('A quiet vow.');
    expect((await compose(own)).breakdown.seedSource).toBe('campaign');
    const prev = campaign({ template: AI_ONLY, hashtags: [], ...evolving() });
    svc.contexts.setHashtagState(prev.id, { current: ['Glow'], recent: ['Glow'] });
    ai('A quiet vow.');
    expect((await compose(svc.contexts.getContext(prev.id)!)).breakdown.seedSource).toBe(
      'previous',
    );
  });

  it('leaves #1, #2026, C#, URL fragments, entities and hex codes alone', async () => {
    const ctx = campaign({ template: AI_ONLY, ...evolving() });
    const body = 'We were #1 in #2026, coding C# at https://x.com/a#b &#39;yes&#39; (#C03F0B).';
    ai(body);
    const out = await compose(ctx);
    expect(out.text).toBe(`${body} #Heart #Muse #Longing`);
    expect(out.breakdown.dehashedAiHashtags).toBeUndefined();
  });

  it('keeps emoji that sat in the AI tag cluster', async () => {
    const ctx = campaign({ template: AI_ONLY, ...evolving() });
    ai('Roses bloom 🌹 #love #roses');
    expect((await compose(ctx)).text).toBe('Roses bloom 🌹 #Heart #love #roses');
  });

  it('never posts a hashtag twice, even CamelCase/underscore variants of an evolved tag', async () => {
    next.mockResolvedValue({ tags: ['EternalLove', 'Muse'], source: 'offline' });
    const ctx = campaign({ template: 'Dawn #eternal_love <agent>x</agent>', ...evolving(2) });
    expect(ctx.hashtags).toEqual(['eternal_love']); // moved out on create
    svc.contexts.patchContext(ctx.id, { template: 'Dawn #eternal_love <agent>x</agent>' });
    ai('An #eternallove poem. #muse #MUSE');
    const out = await compose(svc.contexts.getContext(ctx.id)!);
    // The template's inline #eternal_love reads as words; the AI's #eternallove too.
    expect(out.text).toBe('Dawn eternal love An eternallove poem. #EternalLove #Muse');
    expect(out.breakdown.removedDuplicateTags).toEqual(['eternal_love']);
  });
});

describe('length budget', () => {
  const sentence = (n: number) => `${'word '.repeat(n).trim()}.`;

  it('reserves the tag block before trimming: AI ends on a complete sentence and all tags fit', async () => {
    next.mockResolvedValue({
      tags: ['Aurora', 'Daybreak', 'Wonder', 'Hush', 'Ember'],
      source: 'x',
    });
    const ctx = campaign({ template: AI_ONLY, ...evolving(5) });
    const poem = `${sentence(20)} ${sentence(20)} ${sentence(20)}`; // ~300 chars, 3 sentences
    ai(poem, poem); // too long, and the retry too
    const out = await compose(ctx);
    expect(promptOf(1)).toMatch(/too long/);
    expect(out.hashtags).toEqual(['Aurora', 'Daybreak', 'Wonder', 'Hush', 'Ember']);
    expect(out.breakdown.aiText).toBe(`${sentence(20)} ${sentence(20)}`);
    expect(checkTweetText(out.text).ok).toBe(true);
    expect(out.breakdown.droppedTags).toBeUndefined();
  });

  it('drops trailing tags (never cuts the AI mid-sentence) when one sentence needs the room', async () => {
    const ctx = campaign({
      template: 'A static prefix of about forty chars.. <agent>x</agent>',
      hashtags: ['Aurora', 'Glowing', 'Daybreak', 'Wonder'],
    });
    const one = `${'long '.repeat(45).trim()}.`; // one 225-char sentence, no earlier stop
    ai(one, one);
    const out = await compose(ctx);
    expect(out.breakdown.aiText).toBe(one);
    expect(out.breakdown.hashtags).toEqual(['Aurora']);
    expect(out.breakdown.droppedTags).toEqual(['Glowing', 'Daybreak', 'Wonder']);
    expect(weightedTweetLength(out.text)).toBeLessThanOrEqual(280);
  });
});

describe('evolution OFF', () => {
  it('posts the campaign hashtags; AI tags are removed (cluster) / de-hashed (inline)', async () => {
    const ctx = campaign({
      template: '{color_pick} <agent>poem</agent>',
      hashtags: ['eternal', 'colors'],
    });
    ai('Soft light, #Eternal. #colors #Glow');
    const out = await compose(ctx);
    expect(promptOf()).toContain(AGENT_NO_HASHTAGS_DIRECTIVE);
    expect(out.text).toBe('Amber Soft light, Eternal. #eternal #colors');
    expect(out.hashtags).toBeUndefined();
    expect(out.breakdown).toMatchObject({
      tagSource: 'campaign',
      hashtags: ['eternal', 'colors'],
      removedAiHashtags: ['colors', 'Glow'],
      dehashedAiHashtags: ['Eternal'],
    });
  });

  it('without campaign hashtags keeps the AI tags as written, minus template duplicates', async () => {
    const ctx = campaign({ template: 'Verse <agent>x</agent> #poetry', hashtags: [] });
    ai('A #love that stays. #Love #poetry #Muse');
    const out = await compose(ctx);
    expect(promptOf()).not.toContain(AGENT_NO_HASHTAGS_DIRECTIVE);
    expect(out.text).toBe('Verse A #love that stays. #Muse #poetry');
    expect(out.breakdown).toMatchObject({
      tagSource: 'none',
      removedAiHashtags: ['Love', 'poetry'],
    });
  });

  it('never lets AI tags push the tweet over 280', async () => {
    const ctx = campaign({ template: `${'s'.repeat(60)} <agent>x</agent>`, hashtags: [] });
    const body = `${'calm '.repeat(41).trim()}.`; // 209 chars: fits, its tags do not
    ai(`${body} #Serenity #Stillness #Quiet`);
    const out = await compose(ctx);
    expect(out.text.startsWith(`${'s'.repeat(60)} ${body}`)).toBe(true);
    expect(weightedTweetLength(out.text)).toBeLessThanOrEqual(280);
    expect(out.breakdown.removedAiHashtags?.length).toBeGreaterThan(0);
  });

  it('dedupes {weather_tweet} tags against the campaign block', async () => {
    const ctx = campaign({ template: '{weather_tweet}', hashtags: ['colors', 'Dawn'] });
    const out = await compose(ctx);
    expect(out.text).toBe('Amber soft air #eternal #colors #Dawn');
    expect(out.breakdown.removedDuplicateTags).toEqual(['colors']);
  });
});

describe('Gemini unavailable', () => {
  it('an AI-only template still fails visibly (AgentUnavailableError)', async () => {
    process.env.GEMINI_API_KEY = '';
    const ctx = campaign({ template: AI_ONLY, ...evolving() });
    await expect(compose(ctx)).rejects.toBeInstanceOf(AgentUnavailableError);
    // The drop fails visibly: an error log entry, X never called.
    const out = await makeDrops().executeDrop({ contextId: ctx.id, color });
    expect(out.success).toBe(false);
    expect(out.log).toMatchObject({ status: 'error', tweetText: '' });
    expect(out.log.errorMessage).toMatch(/not configured/);
    expect(post).not.toHaveBeenCalled();
    expect(svc.contexts.getContext(ctx.id)?.hashtagState).toBeUndefined();
  });
});

describe('preview == post, per-campaign state', () => {
  it('posts exactly the previewed text and records exactly its tags, once', async () => {
    const ctx = campaign({ template: AI_ONLY, ...evolving() });
    ai('this #love burns. #Devotion #Poetry');
    const preview = await compose(ctx);
    const drops = makeDrops();
    const out = await drops.executeDrop({
      contextId: ctx.id,
      text: preview.text,
      hashtags: preview.hashtags,
      color,
    });
    expect(post.mock.calls[0][1].text).toBe(preview.text);
    expect(out.hashtags).toEqual(['Heart', 'Muse', 'Poetry']);
    expect(svc.contexts.getContext(ctx.id)?.hashtagState).toEqual({
      current: ['Heart', 'Muse', 'Poetry'],
      recent: ['Heart', 'Muse', 'Poetry'],
    });
    expect(generateContent).toHaveBeenCalledTimes(1); // preview only; the post did not re-run AI
  });

  it('two campaigns with the same template evolve independently', async () => {
    const a = campaign({ name: 'A', template: AI_ONLY, ...evolving() });
    const b = campaign({ name: 'B', template: AI_ONLY, ...evolving() });
    const drops = makeDrops();
    ai('One.', 'Two.', 'Three.');
    await drops.executeDrop({ contextId: a.id, color });
    next.mockResolvedValue({ tags: ['Hush', 'Dawn'], source: 'offline' });
    await drops.executeDrop({ contextId: a.id, color });
    let seenByB: unknown = 'not called';
    next.mockImplementation(async (c: TweetContext) => {
      seenByB = c.hashtagState;
      return { tags: ['Tide'], source: 'offline' };
    });
    await drops.executeDrop({ contextId: b.id, color });
    expect(svc.contexts.getContext(a.id)?.hashtagState).toEqual({
      current: ['Hush', 'Dawn'],
      recent: ['Heart', 'Muse', 'Longing', 'Hush', 'Dawn'],
    });
    expect(svc.contexts.getContext(b.id)?.hashtagState).toEqual({
      current: ['Tide'],
      recent: ['Tide'],
    });
    // B's evolver saw only B's (empty) state.
    expect(seenByB).toBeUndefined();
  });

  it('a failed post or a preview never advances the state', async () => {
    const ctx = campaign({ template: AI_ONLY, ...evolving() });
    ai('One.', 'Two.');
    await compose(ctx);
    post.mockResolvedValue({ success: false, error: 'boom', httpStatus: 500 });
    await makeDrops().executeDrop({ contextId: ctx.id, color });
    expect(svc.contexts.getContext(ctx.id)?.hashtagState).toBeUndefined();
  });
});
