import { describe, expect, it } from 'vitest';
import { resolveReplyTarget, sanitizeContextChain } from '../../server/services/contextChain.js';
import type { PostLog, TweetContext } from '../../shared/types.js';

/** A campaign whose anchor carries server-written provenance (as `recordContextPostResult` does). */
const campaign = (id: string, target: string, anchor?: string, anchorTarget = target) =>
  ({
    id,
    targetTweetId: target,
    replyTargetMode: 'last_comment',
    lastPostedTweetId: anchor,
    chainAnchor: anchor
      ? { tweetId: anchor, targetTweetId: anchorTarget, postedAt: new Date().toISOString() }
      : undefined,
  }) as unknown as TweetContext;

/** A legacy anchor: `lastPostedTweetId` only, no provenance. */
const legacy = (id: string, target: string, anchor: string) =>
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

  it('keeps following a provenance-backed anchor whose log was trimmed (MAX_LOGS)', () => {
    const a = campaign('ctx_a', '1000', '999'); // no log for 999 any more
    expect(resolveReplyTarget(a, logs).targetTweetId).toBe('999');
  });

  it('treats a legacy / imported anchor without provenance as unverified (root)', () => {
    expect(resolveReplyTarget(legacy('ctx_a', '1000', '999'), logs).targetTweetId).toBe('1000');
    // ...even when a log happens to mention it: provenance is set by sanitizeContextChain at boot
    expect(resolveReplyTarget(legacy('ctx_a', '1000', '111'), logs).targetTweetId).toBe('1000');
  });

  it('upgrades a legacy anchor to provenance at boot only when a log proves it', () => {
    const proven = legacy('ctx_a', '1000', '111');
    expect(sanitizeContextChain(proven, logs)).toBe(true);
    expect(proven.chainAnchor).toMatchObject({ tweetId: '111', targetTweetId: '1000' });
    const unproven = legacy('ctx_a', '1000', '999');
    expect(sanitizeContextChain(unproven, logs)).toBe(true);
    expect(unproven.lastPostedTweetId).toBeUndefined();
    const stolen = legacy('ctx_a', '1000', '222'); // B's tweet
    sanitizeContextChain(stolen, logs);
    expect(stolen.lastPostedTweetId).toBeUndefined();
  });

  it('ignores an anchor posted against a different target of the same campaign', () => {
    const a = campaign('ctx_a', '3000', '111', '1000'); // provenance says target 1000
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
    const active = svc.contexts.requireActiveContext();
    svc.contexts.patchContext(active.id, { targetTweetId: '5555555555' });
    svc.settings.updateSettings({ targetTweetId: '5555555555' });
    const fresh = svc.contexts.createContext({ name: 'second' });
    expect(fresh.targetTweetId).not.toBe('5555555555');
  });
});
