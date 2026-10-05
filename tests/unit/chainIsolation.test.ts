import { describe, expect, it } from 'vitest';
import { resolveReplyTarget } from '../../server/services/contextChain.js';
import type { PostLog, TweetContext } from '../../shared/types.js';

const campaign = (id: string, target: string, anchor?: string) =>
  ({
    id,
    targetTweetId: target,
    replyTargetMode: 'last_comment',
    lastPostedTweetId: anchor,
  }) as unknown as TweetContext;

const log = (over: Partial<PostLog>): PostLog =>
  ({
    id: `log_${over.tweetId}`,
    timestamp: new Date().toISOString(),
    status: 'success',
    engagementMode: 'reply',
    ...over,
  }) as PostLog;

describe('reply chain isolation between campaigns', () => {
  const logs = [
    log({ tweetId: '111', contextId: 'ctx_a', targetTweetId: '1000' }),
    log({ tweetId: '222', contextId: 'ctx_b', targetTweetId: '2000' }),
  ];

  it("follows the campaign's own verified anchor", () => {
    expect(resolveReplyTarget(campaign('ctx_a', '1000', '111'), logs).targetTweetId).toBe('111');
  });

  it("never follows another campaign's tweet", () => {
    const a = campaign('ctx_a', '1000', '222'); // polluted with B's tweet
    expect(resolveReplyTarget(a, logs)).toMatchObject({
      targetTweetId: '1000',
      isFirstInChain: true,
    });
  });

  it('falls back to the root when the anchor is not in history (imported / aged out)', () => {
    const a = campaign('ctx_a', '1000', '999');
    expect(resolveReplyTarget(a, logs).targetTweetId).toBe('1000');
  });

  it('ignores an anchor posted against a different target of the same campaign', () => {
    const a = campaign('ctx_a', '3000', '111');
    expect(resolveReplyTarget(a, logs).targetTweetId).toBe('3000');
  });

  it('ignores a failed or simulated post as an anchor', () => {
    const sim = [
      log({ tweetId: '333', contextId: 'ctx_a', targetTweetId: '1000', status: 'simulated' }),
    ];
    expect(resolveReplyTarget(campaign('ctx_a', '1000', '333'), sim).targetTweetId).toBe('1000');
  });
});

describe('new campaign target', () => {
  it("does not inherit the active campaign's target", async () => {
    const { createServices } = await import('../../server/services/index.js');
    const { MemoryStore } = await import('../../server/store/MemoryStore.js');
    const svc = await createServices(new MemoryStore());
    const active = svc.contexts.getActiveContext();
    svc.contexts.patchContext(active.id, { targetTweetId: '5555555555' });
    svc.settings.updateSettings({ targetTweetId: '5555555555' });
    const fresh = svc.contexts.createContext({ name: 'second' });
    expect(fresh.targetTweetId).not.toBe('5555555555');
  });
});
