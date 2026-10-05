import { describe, expect, it } from 'vitest';
import {
  dedupeHashtags,
  dehashInline,
  findHashtags,
  finishAgentText,
  isHashtagExpression,
  shapeAgentText,
  splitTrailingHashtags,
} from '../../shared/hashtags/index.js';
import { weightedTweetLength } from '../../shared/tweetLength.js';

describe('isHashtagExpression / findHashtags', () => {
  it('treats numbers, hex colors and unusable tags as expressions', () => {
    expect(isHashtagExpression('1')).toBe(true);
    expect(isHashtagExpression('2026')).toBe(true);
    expect(isHashtagExpression('C03F0B')).toBe(true);
    expect(isHashtagExpression('fff000')).toBe(true);
    expect(isHashtagExpression('love')).toBe(false);
    expect(isHashtagExpression('cafe')).toBe(false); // hex letters only: a word
  });

  it('never sees C#, URL fragments or HTML entities as hashtags', () => {
    const text =
      'We are #1 in 2026 #2026, I code C# and read https://x.com/page#intro or https://a.b/#top &#39;ok&#39; (#C03F0B) #love';
    expect(findHashtags(text)).toEqual(['love']);
  });
});

describe('splitTrailingHashtags', () => {
  it('lifts a trailing cluster', () => {
    expect(splitTrailingHashtags('The ember burns. #love #poetry')).toEqual({
      body: 'The ember burns.',
      tags: ['love', 'poetry'],
    });
  });

  it('lifts a cluster on its own line and a single tag after a sentence end', () => {
    expect(splitTrailingHashtags('Line one\nline two\n#Devotion #EternalLove')).toEqual({
      body: 'Line one\nline two',
      tags: ['Devotion', 'EternalLove'],
    });
    expect(splitTrailingHashtags('It burns! #love')).toEqual({ body: 'It burns!', tags: ['love'] });
  });

  it('keeps a single tag glued to the end of a sentence (that is inline)', () => {
    expect(splitTrailingHashtags('this love is #endless')).toEqual({
      body: 'this love is #endless',
      tags: [],
    });
  });

  it('keeps emoji and #2026-like expressions found in the cluster, in order', () => {
    expect(splitTrailingHashtags('Hold on. 🌹 #love #2026 #poetry')).toEqual({
      body: 'Hold on. 🌹 #2026',
      tags: ['love', 'poetry'],
    });
    expect(splitTrailingHashtags('Hold on. #love💕 #poetry.')).toEqual({
      body: 'Hold on. 💕',
      tags: ['love', 'poetry'],
    });
  });

  it('does nothing without tags or when only expressions trail', () => {
    expect(splitTrailingHashtags('We are #1')).toEqual({ body: 'We are #1', tags: [] });
    expect(splitTrailingHashtags('plain words')).toEqual({ body: 'plain words', tags: [] });
  });
});

describe('dehashInline', () => {
  it('turns inline tags into readable words', () => {
    expect(dehashInline('this #love burns, an #EternalLove of #golden_hour light')).toEqual({
      text: 'this love burns, an Eternal Love of golden hour light',
      dehashed: ['love', 'EternalLove', 'golden_hour'],
    });
  });

  it('leaves expressions alone', () => {
    const text = 'We are #1 since #2026 in C# at https://x.com/a#b &#39;';
    expect(dehashInline(text)).toEqual({ text, dehashed: [] });
  });
});

describe('dedupeHashtags', () => {
  it('removes later duplicates in clusters and de-hashes inline ones (case/CamelCase-insensitive)', () => {
    expect(dedupeHashtags('a #Love story. #love #Poetry #poetry')).toEqual({
      text: 'a #Love story. #Poetry',
      removed: ['love', 'poetry'],
    });
  });

  it('removes body tags already in the reserved block', () => {
    expect(dedupeHashtags('Amber air #eternal #colors', ['Colors'])).toEqual({
      text: 'Amber air #eternal',
      removed: ['colors'],
    });
    expect(dedupeHashtags('a #love note for you', ['love'])).toEqual({
      text: 'a love note for you',
      removed: ['love'],
    });
    expect(dedupeHashtags('#Eternal_Love here', ['eternallove']).text).toBe('Eternal Love here');
  });

  it('keeps line breaks and expressions', () => {
    expect(dedupeHashtags('#1 line\n#love\nend #1', ['love']).text).toBe('#1 line\n\nend #1');
  });
});

describe('shapeAgentText', () => {
  it('managed: lifts the trailing cluster and de-hashes inline tags', () => {
    expect(
      shapeAgentText('this #love burns past #2026. #Devotion #Poetry', { managed: true }),
    ).toEqual({
      body: 'this love burns past #2026.',
      tail: [],
      lifted: ['Devotion', 'Poetry'],
      dehashed: ['love'],
      removed: [],
    });
  });

  it('unmanaged: keeps the model tags but drops duplicates of the template and of each other', () => {
    expect(
      shapeAgentText('A #love that stays #Love. #poetry #Muse #muse', {
        managed: false,
        reservedTags: ['poetry'],
      }),
    ).toEqual({
      body: 'A #love that stays Love.',
      tail: ['Muse'],
      lifted: [],
      dehashed: [],
      removed: ['Love', 'poetry', 'muse'],
    });
  });
});

describe('finishAgentText', () => {
  const poem =
    'The tide remembers every name we gave the dark. It keeps them folded in salt and patient silver light. And when the morning breaks we will be there, still listening.';

  it('ends on a complete sentence within the budget', () => {
    const out = finishAgentText({ body: poem, tail: [] }, 110);
    expect(out.text).toBe(
      'The tide remembers every name we gave the dark. It keeps them folded in salt and patient silver light.',
    );
  });

  it('prefers a longer complete sentence (dropping tags later) over a mid-sentence cut', () => {
    const one =
      'A single long sentence that keeps going and going without ever stopping for breath';
    const out = finishAgentText({ body: one, tail: [] }, 60, 120);
    expect(out.text).toBe(one);
  });

  it('drops kept tail tags from the end before touching the text', () => {
    const out = finishAgentText({ body: 'Short and sweet.', tail: ['love', 'Poetry'] }, 24);
    expect(out).toEqual({ text: 'Short and sweet. #love', droppedTail: ['Poetry'] });
    expect(weightedTweetLength(out.text)).toBeLessThanOrEqual(24);
  });
});
