import { describe, expect, it } from 'vitest';
import {
  ALL_TERMS,
  RECENT_LIMIT,
  advanceHashtagState,
  applyHashtags,
  evolveOffline,
  fitHashtags,
  getSeedTags,
  normaliseEvolution,
  normaliseTag,
  normaliseTags,
  parseHashtags,
  relatedTerms,
} from '../../shared/hashtags/index.js';
import { checkTweetText } from '../../shared/tweetLength.js';

/** Small deterministic PRNG (LCG) so generator tests are reproducible. */
const makeRng = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

describe('parseHashtags', () => {
  it('finds #tags with Unicode letters, digits and underscores', () => {
    expect(parseHashtags('a #eternal b #Colors_1 c #Café #日本語 #x')).toEqual([
      'eternal',
      'Colors_1',
      'Café',
      '日本語',
    ]);
  });

  it('ignores URL fragments, glued hashes and number-only tags, and de-dupes case-insensitively', () => {
    expect(
      parseHashtags('see https://x.com/a/#frag and a#glued #123 ##double #Love #love'),
    ).toEqual(['Love']);
  });
});

describe('normaliseTag', () => {
  it('strips #, makes CamelCase from words and keeps existing casing', () => {
    expect(normaliseTag('#Sunset Topaz')).toBe('SunsetTopaz');
    expect(normaliseTag('sunset topaz')).toBe('SunsetTopaz');
    expect(normaliseTag('golden-hour!')).toBe('GoldenHour');
    expect(normaliseTag('#eternalLove')).toBe('eternalLove');
    expect(normaliseTag('NASA')).toBe('NASA');
  });

  it('enforces 2-30 chars and rejects digit-only tags', () => {
    expect(normaliseTag('a')).toBeNull();
    expect(normaliseTag('ab')).toBe('ab');
    expect(normaliseTag('x'.repeat(30))).toHaveLength(30);
    expect(normaliseTag('x'.repeat(31))).toBeNull();
    expect(normaliseTag('2024')).toBeNull();
    expect(normaliseTag('###')).toBeNull();
  });

  it('normaliseTags drops invalid entries and de-dupes case-insensitively (first wins)', () => {
    expect(normaliseTags(['#Love', 'love', 'x', 'Sky Line', 'SKYLINE'])).toEqual([
      'Love',
      'SkyLine',
    ]);
  });
});

describe('applyHashtags', () => {
  it('puts the new tags where the first seed tag was and removes the other seeds', () => {
    expect(
      applyHashtags('Amber air #eternal #colors', ['eternal', 'colors'], ['Glow', 'Dawn']),
    ).toBe('Amber air #Glow #Dawn');
    expect(applyHashtags('#eternal Amber air #colors', ['eternal', 'colors'], ['Glow'])).toBe(
      '#Glow Amber air',
    );
  });

  it('matches seed tags case-insensitively and only as whole tokens', () => {
    expect(applyHashtags('x #Eternal #eternally', ['eternal'], ['Glow'])).toBe(
      'x #Glow #eternally',
    );
  });

  it('appends when the text has none of the seed tags', () => {
    expect(applyHashtags('Just words', [], ['Glow', 'Dawn'])).toBe('Just words #Glow #Dawn');
    expect(applyHashtags('Just words', ['missing'], ['Glow'])).toBe('Just words #Glow');
  });

  it('leaves the text alone when there is nothing to add and nothing to replace', () => {
    expect(applyHashtags('Just words', [], [])).toBe('Just words');
  });
});

describe('fitHashtags', () => {
  it('keeps every tag when the tweet fits', () => {
    const out = fitHashtags('hi #eternal', ['eternal'], ['Aurora', 'Glow']);
    expect(out).toEqual({ text: 'hi #Aurora #Glow', tags: ['Aurora', 'Glow'] });
  });

  it('drops trailing tags until the 280 limit holds', () => {
    const body = 'x'.repeat(266);
    const out = fitHashtags(`${body} #eternal`, ['eternal'], ['Aurora', 'Glowing', 'Dawn']);
    expect(out.tags).toEqual(['Aurora']);
    expect(out.text).toBe(`${body} #Aurora`);
    expect(checkTweetText(out.text).ok).toBe(true);
  });

  it('returns the original text with no tags when even zero tags cannot fit', () => {
    const text = `${'y'.repeat(300)} #eternal`;
    expect(fitHashtags(text, ['eternal'], ['Aurora'])).toEqual({ text, tags: [] });
  });
});

describe('getSeedTags', () => {
  it('reads template hashtags, expands {weather_tweet} and ignores <agent> prompts', () => {
    expect(getSeedTags('{color_pick} #Love #eternal').found).toEqual(['Love', 'eternal']);
    expect(getSeedTags('{weather_tweet}').found).toEqual(['eternal', 'colors']);
    expect(getSeedTags('<agent>write about #secret</agent> hi').found).toEqual([]);
  });

  it('falls back to #colors when the template has no hashtag', () => {
    expect(getSeedTags('{color_pick} {hex}')).toEqual({ found: [], seed: ['colors'] });
  });
});

describe('evolveOffline', () => {
  const opts = { seed: ['eternal', 'colors'], maxTags: 3, colorName: 'Sunset Topaz' };

  it('is deterministic for a given rng and returns a color-derived tag first', () => {
    const a = evolveOffline(['eternal', 'colors'], { ...opts, rng: makeRng(1) });
    const b = evolveOffline(['eternal', 'colors'], { ...opts, rng: makeRng(1) });
    expect(a).toEqual(b);
    expect(a[0]).toBe('SunsetTopaz');
    expect(a).toHaveLength(3);
  });

  it('never repeats a recent tag across 20 iterations and respects maxTags', () => {
    const rng = makeRng(42);
    let state = advanceHashtagState(undefined, []);
    const used: string[] = [];
    for (let i = 0; i < 20; i++) {
      const tags = evolveOffline(state.current.length ? state.current : opts.seed, {
        ...opts,
        maxTags: 2,
        colorName: `Color Number${i}x`,
        recent: state.recent,
        rng,
      });
      expect(tags.length).toBeGreaterThan(0);
      expect(tags.length).toBeLessThanOrEqual(2);
      for (const t of tags) expect(used.map((u) => u.toLowerCase())).not.toContain(t.toLowerCase());
      used.push(...tags);
      state = advanceHashtagState(state, tags);
    }
  });

  it('only repeats once a tag has left the recent window', () => {
    const rng = makeRng(9);
    let state = advanceHashtagState(undefined, []);
    for (let i = 0; i < 60; i++) {
      const tags = evolveOffline(state.current, {
        ...opts,
        colorName: undefined,
        recent: state.recent,
        rng,
      });
      const recent = state.recent.map((t) => t.toLowerCase());
      for (const t of tags) expect(recent).not.toContain(t.toLowerCase());
      state = advanceHashtagState(state, tags);
    }
    expect(state.recent.length).toBeLessThanOrEqual(RECENT_LIMIT);
  });

  it('clamps maxTags to 1-5', () => {
    expect(evolveOffline(['eternal'], { maxTags: 99, rng: makeRng(3) })).toHaveLength(5);
    expect(evolveOffline(['eternal'], { maxTags: 0, rng: makeRng(3) })).toHaveLength(1);
  });

  it('keepSeedTags keeps the originals (they count toward maxTags, one slot always evolves)', () => {
    const tags = evolveOffline(['eternal', 'colors'], {
      seed: ['eternal', 'colors'],
      keepSeedTags: true,
      maxTags: 3,
      rng: makeRng(5),
    });
    expect(tags.slice(0, 2)).toEqual(['eternal', 'colors']);
    expect(tags).toHaveLength(3);

    const tight = evolveOffline(['a1', 'b2', 'c3'], {
      seed: ['a1', 'b2', 'c3'],
      keepSeedTags: true,
      maxTags: 2,
      rng: makeRng(5),
    });
    expect(tight[0]).toBe('a1');
    expect(tight).toHaveLength(2);
    expect(tight[1]).not.toBe('b2');
  });

  it('without keepSeedTags the seed tags are replaced, not echoed', () => {
    const tags = evolveOffline(['eternal', 'colors'], { ...opts, rng: makeRng(8) });
    expect(tags.map((t) => t.toLowerCase())).not.toContain('eternal');
    expect(tags.map((t) => t.toLowerCase())).not.toContain('colors');
  });

  it('works for unknown seeds and skips a color tag that was used recently', () => {
    const tags = evolveOffline(['zzzunknown'], {
      maxTags: 3,
      colorName: 'Sunset Topaz',
      recent: ['sunsettopaz'],
      rng: makeRng(2),
    });
    expect(tags).toHaveLength(3);
    expect(tags.map((t) => t.toLowerCase())).not.toContain('sunsettopaz');
  });
});

describe('graph, config and state', () => {
  it('has about 150 terms, all valid hashtags, with neighbours', () => {
    expect(ALL_TERMS.length).toBeGreaterThanOrEqual(140);
    for (const t of ALL_TERMS) expect(normaliseTag(t)).toBe(t);
    expect(relatedTerms('Sunset')).toContain('sunrise');
    expect(relatedTerms('nope-not-a-term')).toEqual([]);
  });

  it('normaliseEvolution fills defaults and clamps', () => {
    expect(normaliseEvolution()).toEqual({ enabled: false, maxTags: 3, keepSeedTags: false });
    expect(normaliseEvolution({ enabled: true, maxTags: 9 })).toMatchObject({
      enabled: true,
      maxTags: 5,
    });
    expect(normaliseEvolution({ maxTags: 4 }, { keepSeedTags: true })).toEqual({
      enabled: false,
      maxTags: 4,
      keepSeedTags: true,
    });
  });

  it('advanceHashtagState sets current, de-dupes and caps recent', () => {
    let s = advanceHashtagState(undefined, ['A1', 'B2']);
    expect(s).toEqual({ current: ['A1', 'B2'], recent: ['A1', 'B2'] });
    s = advanceHashtagState(s, ['b2', 'C3']);
    expect(s.current).toEqual(['b2', 'C3']);
    expect(s.recent).toEqual(['A1', 'b2', 'C3']);
    for (let i = 0; i < 30; i++) s = advanceHashtagState(s, [`tagA${i}`, `tagB${i}`]);
    expect(s.recent).toHaveLength(RECENT_LIMIT);
    expect(s.recent.at(-1)).toBe('tagB29');
  });
});
