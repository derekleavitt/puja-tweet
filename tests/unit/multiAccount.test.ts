import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scheduler } from '../../server/scheduler.js';
import { createDropService } from '../../server/services/dropService.js';
import { dropService } from '../../server/services/dropService.js';
import { createServices, services, type Services } from '../../server/services/index.js';
import { MemoryStore } from '../../server/store/MemoryStore.js';
import { oauth1AccessToken, oauth1RequestToken } from '../../server/twitterClient.js';
import type { TwitterCredentials } from '../../server/twitterClient.js';

vi.mock('../../server/twitterClient.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../server/twitterClient.js')>()),
  oauth1RequestToken: vi.fn(),
  oauth1AccessToken: vi.fn(),
  postColorTweet: vi.fn(async () => {
    throw new Error('X must not be called from multi-account tests');
  }),
}));

const TARGET = '1700000000000000001';
const post = vi.fn();
const resolveText = vi.fn();
let svc: Services;

/** Connects an X user through the (mocked) PIN flow; returns its account id. */
const connectAccount = async (target: Services, userId: string, handle: string) => {
  vi.mocked(oauth1RequestToken).mockResolvedValueOnce({
    oauthToken: `req-${userId}`,
    oauthTokenSecret: 'rs',
    callbackConfirmed: true,
  });
  vi.mocked(oauth1AccessToken).mockResolvedValueOnce({
    accessToken: `token-${userId}`,
    accessTokenSecret: `secret-${userId}`,
    userId,
    screenName: handle,
  });
  await target.accounts.startConnect('oob');
  return (await target.accounts.completeConnect(`req-${userId}`, '1234')).id;
};

const makeDrops = () =>
  createDropService({
    services: svc,
    postColorTweet: post as never,
    resolveTemplateText: resolveText as never,
  });

const credsOf = (call: number) => post.mock.calls[call][0] as TwitterCredentials;

beforeEach(async () => {
  vi.stubEnv('TWITTER_API_KEY', 'consumer-key');
  vi.stubEnv('TWITTER_API_SECRET', 'consumer-secret');
  vi.stubEnv('TWITTER_ACCESS_TOKEN', 'env-token');
  vi.stubEnv('TWITTER_ACCESS_TOKEN_SECRET', 'env-secret');
  vi.stubEnv('CREDENTIALS_ENCRYPTION_KEY', 'c'.repeat(64));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  svc = await createServices(new MemoryStore());
  svc.settings.updateSettings({ globalDryRun: false, globalPaused: false });
  post.mockReset().mockResolvedValue({ success: true, tweetId: '999', url: 'u' });
  resolveText.mockReset().mockResolvedValue('hello');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('posting as the campaign account', () => {
  it("signs each campaign's post with its own account token", async () => {
    const second = await connectAccount(svc, '222', 'second_acct');
    const third = await connectAccount(svc, '333', 'third_acct');
    const a = svc.contexts.createContext({ name: 'A', targetTweetId: TARGET, accountId: second });
    const b = svc.contexts.createContext({ name: 'B', targetTweetId: TARGET, accountId: third });
    const d = svc.contexts.createContext({ name: 'D', targetTweetId: TARGET });

    const outA = await makeDrops().executeDrop({ contextId: a.id, slotType: 'manual' });
    await makeDrops().executeDrop({ contextId: b.id, slotType: 'manual' });
    await makeDrops().executeDrop({ contextId: d.id, slotType: 'manual' });

    expect(credsOf(0)).toEqual({
      apiKey: 'consumer-key',
      apiSecret: 'consumer-secret',
      accessToken: 'token-222',
      accessTokenSecret: 'secret-222',
    });
    expect(credsOf(1)).toMatchObject({ accessToken: 'token-333', accessTokenSecret: 'secret-333' });
    expect(credsOf(2)).toMatchObject({ accessToken: 'env-token', accessTokenSecret: 'env-secret' });
    expect(post.mock.calls[0][1]).toMatchObject({ accountHandle: 'second_acct' });
    expect(outA.log).toMatchObject({ accountId: second, accountHandle: 'second_acct' });
    expect(svc.logs.getLogs()[0]).toMatchObject({ accountId: 'acct_env' });
  });

  it('fails without calling X and auto-pauses when the account is revoked', async () => {
    const second = await connectAccount(svc, '222', 'second_acct');
    const a = svc.contexts.createContext({
      name: 'A',
      targetTweetId: TARGET,
      accountId: second,
      enabled: true,
    });
    svc.accounts.markRevoked(second, 'Unauthorized');

    const out = await makeDrops().executeDrop({ contextId: a.id, source: 'scheduler' });
    expect(post).not.toHaveBeenCalled();
    expect(out.success).toBe(false);
    expect(out.log.errorMessage).toMatch(/@second_acct is removed or disconnected/);
    expect(svc.contexts.getContext(a.id)).toMatchObject({
      enabled: false,
      autoPausedReason:
        'Account @second_acct is removed or disconnected — pick an account and resume',
    });
  });

  it('still simulates a dry-run campaign whose account is gone (nothing reaches X)', async () => {
    const second = await connectAccount(svc, '222', 'second_acct');
    const a = svc.contexts.createContext({
      name: 'A',
      targetTweetId: TARGET,
      accountId: second,
      dryRun: true,
    });
    svc.accounts.remove(second);
    post.mockResolvedValue({ success: true, simulated: true, tweetId: 'sim_1' });
    const out = await makeDrops().executeDrop({ contextId: a.id });
    expect(out.log.status).toBe('simulated');
    expect(post.mock.calls[0][2]).toBe(true);
  });

  it('a live 401 marks the account revoked and pauses the campaign', async () => {
    const second = await connectAccount(svc, '222', 'second_acct');
    const a = svc.contexts.createContext({
      name: 'A',
      targetTweetId: TARGET,
      accountId: second,
      enabled: true,
    });
    post.mockResolvedValue({ success: false, httpStatus: 401, error: 'Unauthorized' });
    await makeDrops().executeDrop({ contextId: a.id, source: 'scheduler' });
    expect(svc.accounts.get(second)).toMatchObject({
      status: 'revoked',
      lastError: 'Unauthorized',
    });
    expect(svc.contexts.getContext(a.id)?.enabled).toBe(false);
    expect(svc.accounts.getCredentialsForAccount(second)).toBeNull();
  });

  it('a 429 throttles only the posting account and records spacing per account', async () => {
    const second = await connectAccount(svc, '222', 'second_acct');
    const a = svc.contexts.createContext({ name: 'A', targetTweetId: TARGET, accountId: second });
    post.mockResolvedValue({
      success: false,
      httpStatus: 429,
      isRateLimitOrCooldown: true,
      error: 'Too Many',
    });
    await makeDrops().executeDrop({ contextId: a.id });
    expect(svc.rateLimit.getCooldownState(second).isThrottled).toBe(true);
    expect(svc.rateLimit.getCooldownState().isThrottled).toBe(false);
    expect(svc.rateLimit.getAllCooldownStates()).toMatchObject({
      acct_env: { isThrottled: false },
      [second]: { isThrottled: true },
    });

    post.mockResolvedValue({ success: true, tweetId: '1' });
    svc.rateLimit.clearCooldown(second);
    await makeDrops().executeDrop({ contextId: a.id });
    expect(svc.rateLimit.getTimeSinceLastLivePostMs(second)).toBeLessThan(1000);
    expect(svc.rateLimit.getTimeSinceLastLivePostMs()).toBe(Infinity);
  });
});

describe('scheduler gates per account', () => {
  const HOUR = 3_600_000;
  let second: string;

  beforeEach(async () => {
    services.settings.updateSettings({ globalPaused: false, globalDryRun: false });
    services.rateLimit.clearCooldown();
    second ??= await connectAccount(services, '444', 'sched_acct');
    for (const c of services.contexts.getContexts()) c.enabled = false;
  });

  const dueLive = (name: string, accountId?: string) => {
    const ctx = services.contexts.createContext({
      name,
      targetTweetId: TARGET,
      accountId,
      enabled: true,
      dryRun: false,
    });
    ctx.lastPostedTimestamp = Date.now() - 2 * HOUR;
    ctx.currentJitterMs = 0;
    return ctx;
  };

  it("account A's cooldown does not block account B", async () => {
    const onDefault = dueLive('default acct');
    const onSecond = dueLive('second acct', second);
    services.rateLimit.setCooldown(15, 'reply cooldown');
    const exec = vi.spyOn(dropService, 'executeDrop').mockResolvedValue(undefined as never);
    await scheduler.tick();
    expect(exec.mock.calls.map((c) => c[0]?.contextId)).toEqual([onSecond.id]);
    expect(scheduler.getBlockedReason(onDefault)).toMatch(/X cooldown/);
    expect(scheduler.getBlockedReason(onSecond)).toBeUndefined();
    expect(scheduler.getGlobalBlockedReason()).toBeUndefined();
  });

  it("account B's exhausted rate window (per-user headers) does not block account A", async () => {
    const onDefault = dueLive('default acct');
    const onSecond = dueLive('second acct', second);
    const reset = Math.floor(Date.now() / 1000) + 600;
    services.rateLimit.updateRateLimitTelemetry({ limit: 17, remaining: 0, reset }, second);
    const exec = vi.spyOn(dropService, 'executeDrop').mockResolvedValue(undefined as never);
    await scheduler.tick();
    expect(exec.mock.calls.map((c) => c[0]?.contextId)).toEqual([onDefault.id]);
    expect(scheduler.getBlockedReason(onSecond)).toMatch(/rate-limit window used up/);
    expect(scheduler.getBlockedReason(onDefault)).toBeUndefined();
    expect(scheduler.getGlobalBlockedReason()).toBeUndefined();
    services.rateLimit.updateRateLimitTelemetry({ limit: 17, remaining: 17, reset }, second);
  });

  it("account A's recent live post does not delay account B", async () => {
    const onDefault = dueLive('default acct');
    const onSecond = dueLive('second acct', second);
    services.rateLimit.recordLivePostTimestamp();
    const exec = vi.spyOn(dropService, 'executeDrop').mockResolvedValue(undefined as never);
    await scheduler.tick();
    const fired = exec.mock.calls.map((c) => c[0]?.contextId);
    expect(fired).toContain(onSecond.id);
    expect(fired).not.toContain(onDefault.id);
  });
});
