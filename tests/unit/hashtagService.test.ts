import { describe, expect, it, vi } from 'vitest';
import { generateColor } from '../../server/colorEngine.js';
import {
  buildConversationHashtagPrompt,
  buildHashtagPrompt,
  CONVERSATION_HASHTAG_SYSTEM_INSTRUCTION,
  createHashtagService,
  parseHashtagReply,
} from '../../server/services/hashtagService.js';
import type { TweetContext } from '../../shared/types.js';

const color = { ...generateColor('morning'), colorPick: 'Sunset Topaz', name: 'Sunset Topaz' };

const context = (extra: Partial<TweetContext> = {}) =>
  ({
    id: 'ctx_test',
    template: '{color_pick} #eternal #colors',
    hashtagEvolution: { enabled: true, maxTags: 3, keepSeedTags: false },
    ...extra,
  }) as TweetContext;

/** Every dependency stubbed: nothing here can touch the network. */
const makeService = (over: Partial<Parameters<typeof createHashtagService>[0]> = {}) => {
  const generate = vi.fn(async () => '["Aurora","Daybreak","Hush"]');
  const tryConsume = vi.fn(() => true);
  const service = createHashtagService({
    isConfigured: () => true,
    tryConsume,
    generate,
    rng: () => 0.5,
    ...over,
  });
  return { service, generate, tryConsume };
};

describe('parseHashtagReply', () => {
  it('parses bare, fenced and chatty JSON arrays into normalised tags', () => {
    expect(parseHashtagReply('["#Aurora","golden hour"]')).toEqual(['Aurora', 'GoldenHour']);
    expect(parseHashtagReply('```json\n["Aurora"]\n```')).toEqual(['Aurora']);
    expect(parseHashtagReply('Sure! ["Aurora", "x", 5]')).toEqual(['Aurora']);
  });

  it('returns [] for anything else', () => {
    expect(parseHashtagReply('not json')).toEqual([]);
    expect(parseHashtagReply('{"tags":["a"]}')).toEqual([]);
    expect(parseHashtagReply('[')).toEqual([]);
  });
});

describe('buildHashtagPrompt', () => {
  it('lists the previous tags, the count and the tags to avoid', () => {
    const p = buildHashtagPrompt(['eternal', 'colors'], 3, ['Old'], 'Sunset Topaz');
    expect(p).toContain('Given these hashtags: #eternal #colors, suggest 3 new related');
    expect(p).toContain('no repeats of: #Old');
    expect(p).toContain('JSON array');
  });
});

describe('hashtagService.next', () => {
  it('uses Gemini when configured and the cap allows', async () => {
    const { service, generate, tryConsume } = makeService();
    const out = await service.next(context(), color);
    expect(out).toEqual({ tags: ['Aurora', 'Daybreak', 'Hush'], source: 'gemini' });
    expect(tryConsume).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledTimes(1);
    const prompt = (generate.mock.calls[0] as unknown as [string])[0];
    expect(prompt).toContain('#eternal #colors');
  });

  it('keeps the seed tags first when keepSeedTags is on and drops recent repeats from Gemini', async () => {
    const { service } = makeService();
    const ctx = context({
      hashtagEvolution: { enabled: true, maxTags: 3, keepSeedTags: true },
      hashtagState: { current: ['Aurora'], recent: ['Aurora'] },
    });
    const out = await service.next(ctx, color);
    expect(out.tags).toEqual(['eternal', 'colors', 'Daybreak']);
  });

  it('falls back to offline on invalid JSON', async () => {
    const { service } = makeService({ generate: async () => 'I cannot do that' });
    const out = await service.next(context(), color);
    expect(out.source).toBe('offline');
    expect(out.tags).toHaveLength(3);
    expect(out.tags[0]).toBe('SunsetTopaz');
  });

  it('falls back to offline on an empty array, an error and a timeout', async () => {
    for (const generate of [
      async () => '[]',
      async () => {
        throw new Error('boom');
      },
      async () => {
        throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
      },
    ]) {
      const { service } = makeService({ generate });
      expect((await service.next(context(), color)).source).toBe('offline');
    }
  });

  it('falls back to offline when the daily cap is reached (no model call)', async () => {
    const { service, generate } = makeService({ tryConsume: () => false });
    const out = await service.next(context(), color);
    expect(out.source).toBe('offline');
    expect(generate).not.toHaveBeenCalled();
  });

  it('never calls Gemini when it is not configured', async () => {
    const { service, generate, tryConsume } = makeService({ isConfigured: () => false });
    expect((await service.next(context(), color)).source).toBe('offline');
    expect(generate).not.toHaveBeenCalled();
    expect(tryConsume).not.toHaveBeenCalled();
  });

  it('offline results never repeat recent tags and follow the previous tags', async () => {
    const { service } = makeService({ isConfigured: () => false });
    const recent = ['SunsetTopaz', 'memory', 'coral'];
    const out = await service.next(
      context({ hashtagState: { current: ['memory'], recent } }),
      color,
    );
    const lower = out.tags.map((t) => t.toLowerCase());
    for (const r of recent) expect(lower).not.toContain(r.toLowerCase());
  });

  it('uses the template override for the seed', async () => {
    const { service, generate } = makeService();
    await service.next(context(), color, { template: 'x #Poetry' });
    expect((generate.mock.calls[0] as unknown as [string])[0]).toContain('#Poetry');
  });

  it('seeds from the campaign hashtags (outside the template), keeping some when asked', async () => {
    const { service, generate } = makeService();
    const ctx = context({
      template: '{color_pick}',
      hashtags: ['Vows', 'Ink'],
      hashtagEvolution: { enabled: true, maxTags: 3, keepSeedTags: true },
    });
    const out = await service.next(ctx, color);
    expect((generate.mock.calls[0] as unknown as [string])[0]).toContain('#Vows #Ink');
    expect(out.tags.slice(0, 2)).toEqual(['Vows', 'Ink']);
    const override = await service.next(ctx, color, { hashtags: ['Other'] });
    expect(override.tags[0]).toBe('Other');
  });

  it('non-color templates never get the color name or a color seed', async () => {
    const { service, generate } = makeService();
    const ctx = context({ template: '<agent>a poem of love</agent>', hashtags: [] });
    await service.next(ctx, color);
    const prompt = (generate.mock.calls[0] as unknown as [string])[0];
    expect(prompt).not.toContain('Sunset Topaz');
    expect(prompt).toContain('Given these hashtags: #poetry #love');

    const offline = makeService({ isConfigured: () => false }).service;
    const out = await offline.next(
      context({
        template: '<agent>a poem of love</agent>',
        hashtags: [],
        hashtagEvolution: { enabled: true, maxTags: 3, keepSeedTags: true },
      }),
      color,
    );
    expect(out.tags.map((t) => t.toLowerCase())).not.toContain('sunsettopaz');
    // "keep" applies to the campaign's own tags only, never to the theme seed.
    expect(out.tags.map((t) => t.toLowerCase())).not.toContain('poetry');
  });
});

describe('conversation hashtags (topic)', () => {
  const topic = 'Three anglers argue about trout / The river owes us nothing.';
  const convo = (extra: Partial<TweetContext> = {}) =>
    context({ template: '', hashtags: ['FlyFishing'], ...extra });

  it('asks for popular tags for the subject, with what is trending on X', async () => {
    const trending = vi.fn(async () => ['WorldCup', 'Trout']);
    const { service, generate } = makeService({ trending });
    await service.next(convo(), undefined, { hashtags: ['FlyFishing'], topic });
    expect(trending).toHaveBeenCalledTimes(1);
    const [prompt, system] = generate.mock.calls[0] as unknown as [string, string];
    expect(system).toBe(CONVERSATION_HASHTAG_SYSTEM_INSTRUCTION);
    expect(prompt).toContain(`A public X conversation is about: "${topic}"`);
    expect(prompt).toContain('popular, established tags');
    expect(prompt).toContain('Trending on X right now: #WorldCup #Trout');
    expect(prompt).toContain('only if it truly fits the subject');
  });

  it('never asks for trends for color drops', async () => {
    const trending = vi.fn(async () => ['WorldCup']);
    const { service, generate } = makeService({ trending });
    await service.next(context(), color);
    expect(trending).not.toHaveBeenCalled();
    expect(generate.mock.calls[0]).toHaveLength(1); // default (color) system instruction
  });

  it('only avoids the last two sets, and may return to the seed tags', async () => {
    const recent = ['A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3'];
    const generate = vi.fn(async (_prompt: string) => '["FlyFishing","A1","C3","Trout"]');
    const { service } = makeService({ generate, trending: async () => [] });
    const { tags } = await service.next(
      convo({ hashtagState: { current: ['C1', 'C2', 'C3'], recent } }),
      undefined,
      { hashtags: ['FlyFishing'], topic },
    );
    // A1 is three sets back (allowed again), C3 is in the last set (blocked), the seed is allowed.
    expect(tags).toEqual(['FlyFishing', 'A1', 'Trout']);
    const prompt = generate.mock.calls[0][0];
    expect(prompt).toContain('Do not repeat: #B1 #B2 #B3 #C1 #C2 #C3.');
  });

  it('leaves the trending line out when there are no trends', () => {
    expect(buildConversationHashtagPrompt(['A'], 2, [], 'coffee', [])).not.toContain('Trending');
  });
});
