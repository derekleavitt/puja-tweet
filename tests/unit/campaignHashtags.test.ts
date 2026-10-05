import { describe, expect, it, vi } from 'vitest';
import {
  appendTagBlock,
  extractTemplateHashtags,
  fitTagBlock,
  foldAiTags,
  getSeedTags,
  migrateCampaignHashtags,
  normaliseCampaignTags,
  themeSeedTags,
} from '../../shared/hashtags/index.js';
import { createServices } from '../../server/services/index.js';
import { MemoryStore } from '../../server/store/MemoryStore.js';
import { mapLegacyContext } from '../../server/migration/legacyImport.js';
import { checkTweetText } from '../../shared/tweetLength.js';
import type { TweetContext } from '../../shared/types.js';

describe('extractTemplateHashtags (template -> campaign hashtags)', () => {
  it('moves literal tags out and tidies the whitespace', () => {
    expect(extractTemplateHashtags('{color_pick} {weather_desc} #eternal #colors')).toEqual({
      template: '{color_pick} {weather_desc}',
      hashtags: ['eternal', 'colors'],
    });
    expect(extractTemplateHashtags('#Love begins, here #now.')).toEqual({
      template: 'begins, here.',
      hashtags: ['Love', 'now'],
    });
  });

  it('keeps a tags-only last line as a line break (the block is appended on its own line)', () => {
    expect(extractTemplateHashtags('Dawn <agent>a poem</agent>\n#love #poetry')).toEqual({
      template: 'Dawn <agent>a poem</agent>\n',
      hashtags: ['love', 'poetry'],
    });
  });

  it('never touches <agent> prompts, {weather_tweet} or expressions', () => {
    const t = '<history><agent>write about #secret love</agent></history> {weather_tweet} #1 C#';
    expect(extractTemplateHashtags(t)).toEqual({ template: t, hashtags: [] });
  });

  it('keeps the template when nothing but tags would remain', () => {
    expect(extractTemplateHashtags('#love #poetry')).toEqual({
      template: '#love #poetry',
      hashtags: [],
    });
  });

  it('migrates once: a second run is a no-op', () => {
    const ctx = { template: 'Hi #Muse #Glow', hashtags: undefined as string[] | undefined };
    expect(migrateCampaignHashtags(ctx)).toBe(true);
    expect(ctx).toEqual({ template: 'Hi', hashtags: ['Muse', 'Glow'] });
    ctx.template = 'Hi #again';
    expect(migrateCampaignHashtags(ctx)).toBe(false);
    expect(ctx).toEqual({ template: 'Hi #again', hashtags: ['Muse', 'Glow'] });
  });

  it('normalises and caps campaign tags at 10', () => {
    const many = Array.from({ length: 14 }, (_, i) => `tag${String.fromCharCode(97 + i)}`);
    expect(normaliseCampaignTags(['#Love', 'love', 'golden hour', 5, '#1'])).toEqual([
      'Love',
      'GoldenHour',
    ]);
    expect(normaliseCampaignTags(many)).toHaveLength(10);
  });
});

describe('boot migration in ContextService', () => {
  it('moves template tags into hashtags once per campaign and logs it', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const store = new MemoryStore();
    const first = await createServices(store);
    const id = first.contexts.getActiveContext().id;
    // Simulate a pre-migration campaign (as stored before this release).
    const raw = first.contexts.getContext(id) as TweetContext;
    raw.template = 'Amber {color_pick} #eternal #colors';
    delete raw.hashtags;
    raw.hashtagState = { current: ['Glow'], recent: ['Glow'] };
    await first.flush();

    const second = await createServices(store);
    const migrated = second.contexts.getContext(id)!;
    expect(migrated.template).toBe('Amber {color_pick}');
    expect(migrated.hashtags).toEqual(['eternal', 'colors']);
    expect(migrated.hashtagState?.current).toEqual(['Glow']);
    expect(log.mock.calls.some((c) => String(c[0]).includes('Moved template hashtags'))).toBe(true);

    // Running it again (another boot) changes nothing, even if the template has tags again.
    second.contexts.patchContext(id, { template: 'Amber {color_pick} #kept' });
    await second.flush();
    const third = await createServices(store);
    expect(third.contexts.getContext(id)).toMatchObject({
      template: 'Amber {color_pick} #kept',
      hashtags: ['eternal', 'colors'],
    });
    log.mockRestore();
  });

  it('create moves template tags unless hashtags are given; duplicate copies them', async () => {
    const svc = await createServices(new MemoryStore());
    const a = svc.contexts.createContext({ name: 'A', template: 'A {color_pick} #alpha' });
    expect(a).toMatchObject({ template: 'A {color_pick}', hashtags: ['alpha'] });
    const b = svc.contexts.createContext({
      name: 'B',
      template: 'B #literal',
      hashtags: ['#Own', 'own', 'Second'],
    });
    expect(b).toMatchObject({ template: 'B #literal', hashtags: ['Own', 'Second'] });
    expect(svc.contexts.duplicateContext(b.id).hashtags).toEqual(['Own', 'Second']);
    expect(svc.contexts.updateContext(b.id, { hashtags: ['x', 'Fresh'] }).hashtags).toEqual([
      'Fresh',
    ]);
  });

  it('the legacy importer moves template tags (or takes a hashtags array)', () => {
    expect(mapLegacyContext('c1', { template: 'Old {hex} #eternal' }, [])).toMatchObject({
      template: 'Old {hex}',
      hashtags: ['eternal'],
    });
    expect(mapLegacyContext('c2', { template: 'Old #x1', hashtags: ['Given'] }, [])).toMatchObject({
      template: 'Old #x1',
      hashtags: ['Given'],
    });
  });
});

describe('themeSeedTags / getSeedTags', () => {
  it('derives a neutral theme from the agent prompt for non-color templates', () => {
    expect(
      themeSeedTags('<history><agent>a poem of love and devotion across time</agent></history>'),
    ).toEqual(['poetry', 'love', 'devotion']);
    expect(themeSeedTags('<agent>something about the tide</agent>')).toEqual(['poetry']);
    expect(themeSeedTags('<agent>golden light and amber hues</agent>')).toEqual(['poetry']);
  });

  it('uses #colors only for templates with color tokens', () => {
    expect(themeSeedTags('{color_pick} <agent>love</agent>')).toEqual(['colors']);
    expect(getSeedTags('{color_pick} {hex}').seed).toEqual(['colors']);
    expect(getSeedTags('<agent>love</agent>').seed).toEqual(['love']);
  });
});

describe('tag block placement and fitting', () => {
  it('appends after one space, or on the line when the body ends with a newline', () => {
    expect(appendTagBlock('Amber air', ['a', 'b'])).toBe('Amber air #a #b');
    expect(appendTagBlock('Line\n', ['a'])).toBe('Line\n#a');
    expect(appendTagBlock('Amber air  ', [])).toBe('Amber air');
    expect(appendTagBlock('', ['a'])).toBe('#a');
  });

  it('drops trailing tags only when the tweet would exceed 280', () => {
    const body = 'x'.repeat(268);
    const out = fitTagBlock(body, ['Aurora', 'Glowing', 'Dawn']);
    expect(out.tags).toEqual(['Aurora']);
    expect(checkTweetText(out.text).ok).toBe(true);
  });
});

describe('foldAiTags', () => {
  it('folds AI tags in place of evolved ones from the end, within the reserved length', () => {
    expect(foldAiTags(['Aurora', 'Glow', 'Daybreak'], ['love', 'Devotion'], { kept: 0 })).toEqual({
      tags: ['Aurora', 'love', 'Devotion'],
      folded: ['love', 'Devotion'],
    });
  });

  it('never replaces kept campaign tags, skips blocked/duplicates and longer tags', () => {
    expect(
      foldAiTags(['eternal', 'Glow'], ['Old', 'Aurora', 'SuperLongAiHashtag', 'Ink'], {
        kept: 1,
        blocked: ['old'],
      }),
    ).toEqual({ tags: ['eternal', 'Ink'], folded: ['Ink'] });
  });
});
