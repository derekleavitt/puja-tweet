import { beforeEach, describe, expect, it, vi } from 'vitest';
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
  const id = svc.contexts.getActiveContext().id;
  svc.contexts.patchContext(id, { targetTweetId: '111', ...patch });
  return id;
};

beforeEach(async () => {
  svc = await createServices(new MemoryStore());
  post.mockReset().mockResolvedValue({ success: true, tweetId: '999', url: 'u' });
  resolveText.mockReset().mockResolvedValue('hello');
});

describe('dropService.executeDrop', () => {
  it('replies to the target tweet and logs success', async () => {
    configure({ engagementMode: 'reply', dryRun: false });
    const out = await makeDrops().executeDrop({ slotType: 'morning', source: 'manual' });
    expect(post.mock.calls[0][1]).toMatchObject({
      text: 'hello',
      replyToTweetId: '111',
      quoteTweetId: undefined,
      engagementMode: 'reply',
    });
    expect(post.mock.calls[0][2]).toBe(false);
    expect(out.log).toMatchObject({ status: 'success', tweetId: '999', slotType: 'morning' });
    expect(svc.logs.getLogs()[0].tweetText).toBe('hello');
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
    const color = { colorPick: 'Test' } as never;
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

  describe('chain recovery', () => {
    const chain = () => {
      const id = configure({
        engagementMode: 'reply',
        replyTargetMode: 'last_comment',
        dryRun: false,
        lastPostedTweetId: '555',
      });
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
