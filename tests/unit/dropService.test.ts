import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateColor } from '../../server/colorEngine.js';
import { createDropService } from '../../server/services/dropService.js';
import { createServices, type Services } from '../../server/services/index.js';
import { MemoryStore } from '../../server/store/MemoryStore.js';

let svc: Services;
const post = vi.fn();
const resolveText = vi.fn();

const makeDrops = () =>
  createDropService({
    services: svc,
    postColorTweet: post as never,
    resolveTemplateText: resolveText as never,
  });

const configure = (patch: Record<string, unknown>) => {
  const id = svc.contexts.requireActiveContext().id;
  svc.contexts.patchContext(id, { targetTweetId: '111', ...patch });
  return id;
};

beforeEach(async () => {
  svc = await createServices(new MemoryStore());
  svc.settings.updateSettings({ globalDryRun: false, globalPaused: false });
  post.mockReset().mockResolvedValue({ success: true, tweetId: '999', url: 'u' });
  resolveText.mockReset().mockResolvedValue('hello');
});

describe('dropService.executeDrop', () => {
  it('replies to the target tweet and logs success', async () => {
    configure({ engagementMode: 'reply', dryRun: false });
    const out = await makeDrops().executeDrop({ slotType: 'morning', source: 'manual' });
    expect(post.mock.calls[0][1]).toMatchObject({
      // The default campaign's own hashtags (moved out of the default template) are appended.
      text: 'hello #eternal #colors',
      replyToTweetId: '111',
      quoteTweetId: undefined,
      engagementMode: 'reply',
    });
    expect(post.mock.calls[0][2]).toBe(false);
    expect(out.log).toMatchObject({ status: 'success', tweetId: '999', slotType: 'morning' });
    expect(svc.logs.getLogs()[0].tweetText).toBe('hello #eternal #colors');
  });

  it('quotes the target tweet in quote mode', async () => {
    configure({ engagementMode: 'quote' });
    await makeDrops().executeDrop({ slotType: 'evening' });
    expect(post.mock.calls[0][1]).toMatchObject({
      replyToTweetId: undefined,
      quoteTweetId: '111',
      engagementMode: 'quote',
    });
  });

  it('posts standalone with no reply or quote target', async () => {
    configure({ engagementMode: 'standalone' });
    await makeDrops().executeDrop({ slotType: 'evening' });
    expect(post.mock.calls[0][1]).toMatchObject({
      replyToTweetId: undefined,
      quoteTweetId: undefined,
      engagementMode: 'standalone',
    });
  });

  it('dry-run is simulated, never records a live post, and forceLive overrides it', async () => {
    configure({ dryRun: true });
    post.mockResolvedValue({ success: true, simulated: true, tweetId: 'sim' });
    const record = vi.spyOn(svc.rateLimit, 'recordLivePostTimestamp');
    const out = await makeDrops().executeDrop({ slotType: 'morning' });
    expect(post.mock.calls[0][2]).toBe(true);
    expect(out.log.status).toBe('simulated');
    expect(record).not.toHaveBeenCalled();

    await makeDrops().executeDrop({ slotType: 'morning', forceLive: true });
    expect(post.mock.calls[1][2]).toBe(false);
  });

  describe('global switches', () => {
    it('defaults to dry-run and paused on a fresh store', async () => {
      const fresh = await createServices(new MemoryStore());
      expect(fresh.settings.getSettings()).toMatchObject({
        globalDryRun: true,
        globalPaused: true,
      });
    });

    it('treats a legacy store without the fields as dry-run and paused', async () => {
      const store = new MemoryStore();
      const raw = await store.load();
      delete (raw.settings as { globalDryRun?: boolean }).globalDryRun;
      delete (raw.settings as { globalPaused?: boolean }).globalPaused;
      store.load = async () => raw;
      const legacy = await createServices(store);
      expect(legacy.settings.isGlobalDryRun()).toBe(true);
      expect(legacy.settings.isGlobalPaused()).toBe(true);
    });

    it('global dry-run simulates a live campaign, even with forceLive', async () => {
      configure({ dryRun: false });
      svc.settings.updateSettings({ globalDryRun: true });
      post.mockResolvedValue({ success: true, simulated: true, tweetId: 'sim' });
      const out = await makeDrops().executeDrop({ source: 'manual', forceLive: true });
      expect(post.mock.calls[0][2]).toBe(true);
      expect(out.log.status).toBe('simulated');
    });

    it('global pause blocks scheduled sources but not manual posting', async () => {
      configure({ dryRun: false });
      svc.settings.updateSettings({ globalPaused: true });
      for (const source of ['scheduler', 'webhook', 'cli'] as const) {
        await expect(makeDrops().executeDrop({ source })).rejects.toMatchObject({ status: 409 });
      }
      expect(post).not.toHaveBeenCalled();
      await makeDrops().executeDrop({ source: 'manual' });
      expect(post).toHaveBeenCalledTimes(1);
    });
  });

  it('sets the global cooldown on a rate-limited live post and logs an error', async () => {
    configure({ dryRun: false });
    post.mockResolvedValue({ success: false, error: 'cooldown', isRateLimitOrCooldown: true });
    const out = await makeDrops().executeDrop({ slotType: 'morning' });
    expect(out.success).toBe(false);
    expect(out.log.status).toBe('error');
    expect(svc.rateLimit.getCooldownState().isThrottled).toBe(true);
  });

  it('uses a supplied colour and skips the queue', async () => {
    configure({});
    const color = { ...generateColor('morning'), colorPick: 'Test' };
    const out = await makeDrops().executeDrop({ slotType: 'manual', color });
    expect(resolveText.mock.calls[0][1]).toBe(color);
    expect(out.log.slotType).toBe('manual');
  });

  it('throws 404 for an unknown context without posting', async () => {
    await expect(makeDrops().executeDrop({ contextId: 'nope' })).rejects.toMatchObject({
      status: 404,
    });
    expect(post).not.toHaveBeenCalled();
  });

  it('refuses to post text over 280 weighted characters', async () => {
    const id = configure({ engagementMode: 'standalone' });
    resolveText.mockResolvedValue('x'.repeat(281));
    await expect(makeDrops().executeDrop({ contextId: id })).rejects.toMatchObject({
      status: 400,
    });
    expect(post).not.toHaveBeenCalled();
  });

  describe('quote fallback', () => {
    const restricted = {
      success: false,
      error: 'Reply to this conversation is not allowed because you have not been mentioned',
      httpStatus: 403,
      rawResponse: {
        status: 403,
        detail: 'Reply to this conversation is not allowed because you have not been mentioned',
      },
    };

    it('retries once as a quote of the target when enabled, and logs it', async () => {
      configure({ engagementMode: 'reply', dryRun: false, autoFallbackToQuote: true });
      post.mockResolvedValueOnce(restricted).mockResolvedValueOnce({
        success: true,
        tweetId: '777',
        url: 'u',
        engagementMode: 'quote',
      });
      const out = await makeDrops().executeDrop({ slotType: 'morning' });
      expect(post).toHaveBeenCalledTimes(2);
      expect(post.mock.calls[1][1]).toMatchObject({
        quoteTweetId: '111',
        engagementMode: 'quote',
      });
      expect(post.mock.calls[1][1].replyToTweetId).toBeUndefined();
      expect(out.success).toBe(true);
      expect(out.log).toMatchObject({
        status: 'success',
        engagementMode: 'quote',
        quoteTweetId: '111',
        fallbackTriggered: true,
      });
      expect(svc.rateLimit.getCooldownState().isThrottled).toBe(false);
    });

    it('falls back on a 403 reply cooldown too', async () => {
      configure({ engagementMode: 'reply', dryRun: false, autoFallbackToQuote: true });
      post
        .mockResolvedValueOnce({
          success: false,
          error: 'cooldown',
          httpStatus: 403,
          rawResponse: { status: 403, detail: 'Reply cooldown active' },
        })
        .mockResolvedValueOnce({ success: true, tweetId: '778' });
      const out = await makeDrops().executeDrop({ slotType: 'morning' });
      expect(out.log.fallbackTriggered).toBe(true);
    });

    it('does nothing when disabled (default)', async () => {
      configure({ engagementMode: 'reply', dryRun: false });
      post.mockResolvedValue(restricted);
      const out = await makeDrops().executeDrop({ slotType: 'morning' });
      expect(post).toHaveBeenCalledTimes(1);
      expect(out.log.status).toBe('error');
      expect(out.log.fallbackTriggered).toBeUndefined();
    });

    it('does not fall back on other errors (429, 401, network)', async () => {
      configure({ engagementMode: 'reply', dryRun: false, autoFallbackToQuote: true });
      post.mockResolvedValue({
        success: false,
        error: 'rate',
        httpStatus: 429,
        rawResponse: { status: 429 },
      });
      await makeDrops().executeDrop({ slotType: 'morning' });
      expect(post).toHaveBeenCalledTimes(1);
    });

    it('keeps the original error when the quote retry also fails', async () => {
      configure({ engagementMode: 'reply', dryRun: false, autoFallbackToQuote: true });
      post.mockResolvedValue(restricted);
      const out = await makeDrops().executeDrop({ slotType: 'morning' });
      expect(post).toHaveBeenCalledTimes(2);
      expect(out.log).toMatchObject({ status: 'error', engagementMode: 'reply' });
      expect(out.log.fallbackTriggered).toBeUndefined();
    });
  });

  describe('chain recovery', () => {
    const chain = () => {
      const id = configure({
        engagementMode: 'reply',
        replyTargetMode: 'last_comment',
        dryRun: false,
      });
      // Anchors are server-owned: only this campaign's own successful reply can set one.
      svc.contexts.recordContextPostResult(id, 'success', '555', 'reply');
      svc.logs.addLog({
        id: 'log_1',
        timestamp: new Date().toISOString(),
        slotType: 'manual',
        targetTweetId: '111',
        replyToTweetId: '111',
        engagementMode: 'reply',
        tweetText: 'x',
        tweetId: '555',
        status: 'success',
        contextId: id,
      } as never);
      return id;
    };

    it('retries on the root and only moves the anchor when the anchor tweet is gone', async () => {
      const id = chain();
      post
        .mockResolvedValueOnce({ success: false, error: 'gone', httpStatus: 404, rawResponse: {} })
        .mockResolvedValueOnce({ success: true, tweetId: '777', url: 'u' });
      const regen = vi.spyOn(svc.queue, 'clearAndRegenerateQueue');
      const out = await makeDrops().executeDrop({ contextId: id, slotType: 'morning' });
      expect(post).toHaveBeenCalledTimes(2);
      expect(post.mock.calls[1][1]).toMatchObject({ replyToTweetId: '111' });
      expect(out.success).toBe(true);
      expect(svc.contexts.getContext(id)!.lastPostedTweetId).toBe('777');
      expect(regen).not.toHaveBeenCalled();
    });

    it.each([
      ['401', { httpStatus: 401, rawResponse: {} }],
      ['402', { httpStatus: 402, rawResponse: {} }],
      ['network', {}],
      ['timeout', { isTimeout: true }],
      ['500', { httpStatus: 500, rawResponse: {} }],
    ])('keeps the anchor and does not re-post on %s', async (_n, extra) => {
      const id = chain();
      post.mockResolvedValue({ success: false, error: 'boom', ...extra });
      const out = await makeDrops().executeDrop({ contextId: id, slotType: 'morning' });
      expect(post).toHaveBeenCalledTimes(1);
      expect(out.success).toBe(false);
      expect(svc.contexts.getContext(id)!.lastPostedTweetId).toBe('555');
    });
  });
});
