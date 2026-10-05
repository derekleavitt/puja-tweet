import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateColor } from '../../server/colorEngine.js';
import { createDropService } from '../../server/services/dropService.js';
import { createServices, type Services } from '../../server/services/index.js';
import { MemoryStore } from '../../server/store/MemoryStore.js';
import { checkTweetText } from '../../shared/tweetLength.js';

let svc: Services;
const post = vi.fn();
const resolveText = vi.fn();
const next = vi.fn();
const color = generateColor('morning');

const makeDrops = () =>
  createDropService({
    services: svc,
    postColorTweet: post as never,
    resolveTemplateText: resolveText as never,
    hashtags: { next } as never,
  });

const enable = (patch: Record<string, unknown> = {}) => {
  const id = svc.contexts.getActiveContext().id;
  svc.contexts.patchContext(id, {
    targetTweetId: '111',
    hashtagEvolution: { enabled: true, maxTags: 3, keepSeedTags: false },
    ...patch,
  });
  return id;
};
const stateOf = (id: string) => svc.contexts.getContext(id)?.hashtagState;

beforeEach(async () => {
  svc = await createServices(new MemoryStore());
  svc.settings.updateSettings({ globalDryRun: false, globalPaused: false });
  post.mockReset().mockResolvedValue({ success: true, tweetId: '999', url: 'u' });
  // The template renders the body only; the campaign's tags (#eternal #colors) live outside it.
  resolveText.mockReset().mockResolvedValue('Amber air');
  next.mockReset().mockResolvedValue({ tags: ['Aurora', 'Glow'], source: 'offline' });
});

describe('dropService with evolving hashtags', () => {
  it('posts the evolved text and advances the state after a success', async () => {
    const id = enable();
    const out = await makeDrops().executeDrop({ slotType: 'morning', color });
    expect(post.mock.calls[0][1].text).toBe('Amber air #Aurora #Glow');
    expect(out.hashtags).toEqual(['Aurora', 'Glow']);
    expect(stateOf(id)).toEqual({ current: ['Aurora', 'Glow'], recent: ['Aurora', 'Glow'] });
  });

  it('advances after a simulated post too', async () => {
    const id = enable({ dryRun: true });
    post.mockResolvedValue({ success: true, simulated: true, tweetId: 'sim' });
    await makeDrops().executeDrop({ slotType: 'morning', color });
    expect(stateOf(id)?.current).toEqual(['Aurora', 'Glow']);
  });

  it('does NOT advance when the post fails', async () => {
    const id = enable();
    post.mockResolvedValue({ success: false, error: 'boom', httpStatus: 500 });
    const out = await makeDrops().executeDrop({ slotType: 'morning', color });
    expect(out.success).toBe(false);
    expect(stateOf(id)).toBeUndefined();
  });

  it('does not advance when posting is refused before it starts (invalid text)', async () => {
    const id = enable();
    await expect(
      makeDrops().executeDrop({ text: 'x'.repeat(281), hashtags: ['Aurora'], color }),
    ).rejects.toThrow(/invalid/);
    expect(stateOf(id)).toBeUndefined();
  });

  it('continues from the stored state on the next drop', async () => {
    const id = enable();
    const drops = makeDrops();
    await drops.executeDrop({ slotType: 'morning', color });
    const seen: string[][] = [];
    next.mockImplementation(async (c: { hashtagState?: { current: string[] } }) => {
      seen.push([...(c.hashtagState?.current ?? [])]);
      return { tags: ['Hush', 'Dawn'], source: 'offline' };
    });
    await drops.executeDrop({ slotType: 'morning', color });
    expect(seen).toEqual([['Aurora', 'Glow']]);
    expect(stateOf(id)).toEqual({
      current: ['Hush', 'Dawn'],
      recent: ['Aurora', 'Glow', 'Hush', 'Dawn'],
    });
  });

  it('the preview text equals the posted text and posting it does not re-roll the tags', async () => {
    const id = enable();
    const drops = makeDrops();
    const context = svc.contexts.getContext(id)!;
    const preview = await drops.composeText(context, color);
    expect(preview).toMatchObject({
      text: 'Amber air #Aurora #Glow',
      hashtags: ['Aurora', 'Glow'],
    });

    next.mockClear();
    next.mockResolvedValue({ tags: ['Different'], source: 'offline' });
    await drops.executeDrop({ text: preview.text, hashtags: preview.hashtags, color });
    expect(next).not.toHaveBeenCalled();
    expect(post.mock.calls[0][1].text).toBe(preview.text);
    expect(stateOf(id)?.current).toEqual(['Aurora', 'Glow']);
  });

  it('only remembers tags that are really in the posted text', async () => {
    const id = enable();
    await makeDrops().executeDrop({ text: 'hello #Aurora', hashtags: ['Aurora', 'Ghost'], color });
    expect(stateOf(id)?.current).toEqual(['Aurora']);
    // No claimed tags: fall back to the hashtags found in the text.
    await makeDrops().executeDrop({ text: 'again #Dawn #Glow', color });
    expect(stateOf(id)?.current).toEqual(['Dawn', 'Glow']);
  });

  it('keeps the 280 guard by dropping trailing tags', async () => {
    enable();
    resolveText.mockResolvedValue('x'.repeat(266));
    next.mockResolvedValue({ tags: ['Aurora', 'Glowing', 'Dawn'], source: 'offline' });
    const out = await makeDrops().executeDrop({ color });
    const posted = post.mock.calls[0][1].text as string;
    expect(checkTweetText(posted).ok).toBe(true);
    expect(out.hashtags).toEqual(['Aurora']);
  });

  it('leaves campaigns with evolution off completely untouched', async () => {
    const id = svc.contexts.getActiveContext().id;
    svc.contexts.patchContext(id, { targetTweetId: '111' });
    const out = await makeDrops().executeDrop({ color });
    expect(next).not.toHaveBeenCalled();
    expect(post.mock.calls[0][1].text).toBe('Amber air #eternal #colors');
    expect(out).not.toHaveProperty('hashtags');
    expect(stateOf(id)).toBeUndefined();
  });

  it('every path computes fresh tags itself (scheduler/webhook/CLI sources)', async () => {
    enable();
    for (const source of ['scheduler', 'webhook', 'cli'] as const) {
      next.mockClear();
      await makeDrops().executeDrop({ color, source });
      expect(next).toHaveBeenCalledTimes(1);
    }
  });
});
