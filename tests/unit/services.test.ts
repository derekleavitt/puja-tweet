import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpError } from '../../server/middleware/error.js';
import { createServices, type Services } from '../../server/services/index.js';
import { JsonFileStore } from '../../server/store/JsonFileStore.js';
import { MemoryStore } from '../../server/store/MemoryStore.js';
import type { PostLog } from '../../shared/types.js';

const TWEET = '1234567890123456789';

const makeLog = (over: Partial<PostLog> = {}): PostLog =>
  ({
    id: `log_${Math.random()}`,
    timestamp: new Date().toISOString(),
    slotType: 'morning',
    targetTweetId: TWEET,
    tweetText: 'hi',
    status: 'success',
    ...over,
  }) as PostLog;

describe('services over MemoryStore', () => {
  let store: MemoryStore;
  let svc: Services;

  beforeEach(async () => {
    store = new MemoryStore();
    svc = await createServices(store);
  });

  describe('contextService', () => {
    it('creates the primary context, queue and webhook secret on first boot', async () => {
      expect(svc.contexts.getContexts().map((c) => c.id)).toEqual(['ctx_primary']);
      expect(svc.contexts.getActiveContext().id).toBe('ctx_primary');
      expect(svc.queue.getQueue()).toHaveLength(14);
      expect(svc.credentials.getWebhookSecret()).toHaveLength(64);
      await svc.flush();
      expect(store.snapshot()?.contexts).toHaveLength(1);
    });

    it('creates a context with a cleaned tweet id and its own queue', () => {
      const ctx = svc.contexts.createContext({
        name: ' Camp ',
        targetTweetId: `https://x.com/someone/status/${TWEET}`,
      });
      expect(ctx.name).toBe('Camp');
      expect(ctx.targetTweetId).toBe(TWEET);
      expect(svc.queue.getQueue(ctx.id)).toHaveLength(14);
    });

    it('updateContext keeps only whitelisted fields', () => {
      const ctx = svc.contexts.createContext({ name: 'A', targetTweetId: TWEET });
      const updated = svc.contexts.updateContext(ctx.id, {
        name: 'B',
        stats: { totalPosts: 99, successfulPosts: 99, simulatedPosts: 0, failedPosts: 0 },
        consecutiveErrors: 7,
        createdAt: '1999-01-01T00:00:00.000Z',
        lastPostedTimestamp: 5,
        id: 'ctx_hijack',
      });
      expect(updated.id).toBe(ctx.id);
      expect(updated.name).toBe('B');
      expect(updated.stats?.totalPosts).toBe(0);
      expect(updated.consecutiveErrors).toBeUndefined();
      expect(updated.createdAt).toBe(ctx.createdAt);
      expect(updated.lastPostedTimestamp).toBe(0);
    });

    it('updateContext rejects a bad targetTweetId with 400 and an unknown id with 404', () => {
      const ctx = svc.contexts.createContext({ name: 'A', targetTweetId: TWEET });
      expect(() => svc.contexts.updateContext(ctx.id, { targetTweetId: 'nope' })).toThrow(
        HttpError,
      );
      try {
        svc.contexts.updateContext(ctx.id, { enabled: 'yes' });
        expect.unreachable();
      } catch (err) {
        expect((err as HttpError).status).toBe(400);
      }
      try {
        svc.contexts.updateContext('ctx_missing', {});
        expect.unreachable();
      } catch (err) {
        expect((err as HttpError).status).toBe(404);
      }
    });

    it('accepts a tweet URL on update and resets the chain anchor when the target changes', () => {
      const ctx = svc.contexts.createContext({ name: 'A', targetTweetId: TWEET });
      svc.contexts.patchContext(ctx.id, { lastPostedTweetId: '1111111111111111111' });
      const updated = svc.contexts.updateContext(ctx.id, {
        targetTweetId: 'https://twitter.com/x/status/2222222222222222222',
      });
      expect(updated.targetTweetId).toBe('2222222222222222222');
      expect(updated.lastPostedTweetId).toBeUndefined();
    });

    it('regenerates the queue when a context is edited', () => {
      const ctx = svc.contexts.createContext({ name: 'A', targetTweetId: TWEET });
      const before = svc.queue.getQueue(ctx.id).map((s) => s.slotId);
      svc.contexts.updateContext(ctx.id, { name: 'A2' });
      const after = svc.queue.getQueue(ctx.id);
      expect(after).toHaveLength(14);
      expect(after.every((s) => !before.includes(s.slotId))).toBe(true);
      expect(after[0].contextName).toBe('A2');
    });

    it('refuses to delete the last context, and moves the active context on delete', () => {
      expect(() => svc.contexts.deleteContext('ctx_primary')).toThrow(/only tweet context/);
      const second = svc.contexts.createContext({ name: 'Two', targetTweetId: TWEET });
      svc.contexts.setActiveContextId(second.id);
      expect(svc.contexts.deleteContext(second.id)).toBe(true);
      expect(svc.contexts.getActiveContext().id).toBe('ctx_primary');
      svc.contexts.createContext({ name: 'Three', targetTweetId: TWEET });
      expect(svc.contexts.deleteContext('ctx_missing')).toBe(false);
    });

    it('duplicates paused with a clean chain, and toggles', () => {
      const ctx = svc.contexts.createContext({ name: 'A', targetTweetId: TWEET });
      const copy = svc.contexts.duplicateContext(ctx.id);
      expect(copy.name).toBe('A (Copy)');
      expect(copy.enabled).toBe(false);
      expect(svc.contexts.toggleContext(copy.id).enabled).toBe(true);
    });

    it('records post results: stats, error backoff, and chain anchor only for replies', () => {
      const ctx = svc.contexts.createContext({ name: 'A', targetTweetId: TWEET });
      svc.contexts.recordContextPostResult(ctx.id, 'success', '3333333333333333333', 'reply');
      svc.contexts.recordContextPostResult(ctx.id, 'success', '4444444444444444444', 'quote');
      svc.contexts.recordContextPostResult(ctx.id, 'simulated');
      const afterOk = svc.contexts.getContext(ctx.id)!;
      expect(afterOk.stats).toMatchObject({ totalPosts: 3, successfulPosts: 2, simulatedPosts: 1 });
      expect(afterOk.lastPostedTweetId).toBe('3333333333333333333');

      svc.contexts.recordContextPostResult(ctx.id, 'error');
      const afterErr = svc.contexts.getContext(ctx.id)!;
      expect(afterErr.consecutiveErrors).toBe(1);
      expect(afterErr.stats?.failedPosts).toBe(1);
      expect(afterErr.lastPostedTimestamp).toBeGreaterThan(Date.now() - 1000);
      svc.contexts.recordContextPostResult(ctx.id, 'simulated');
      expect(svc.contexts.getContext(ctx.id)!.consecutiveErrors).toBe(0);
    });

    it('resolves the reply target: root first, then the verified last comment', () => {
      const ctx = svc.contexts.createContext({
        name: 'Chain',
        targetTweetId: TWEET,
        replyTargetMode: 'last_comment',
      });
      expect(svc.contexts.getEffectiveReplyTargetId(ctx)).toEqual({
        targetTweetId: TWEET,
        isCascadingToLastComment: true,
        isFirstInChain: true,
      });
      svc.contexts.recordContextPostResult(ctx.id, 'success', '5555555555555555555');
      const next = svc.contexts.getEffectiveReplyTargetId(svc.contexts.getContext(ctx.id)!);
      expect(next.targetTweetId).toBe('5555555555555555555');
      expect(next.isFirstInChain).toBe(false);
    });

    it('ignores a chain anchor that points at a quote post', () => {
      const ctx = svc.contexts.createContext({
        name: 'Chain',
        targetTweetId: TWEET,
        replyTargetMode: 'last_comment',
      });
      svc.contexts.patchContext(ctx.id, { lastPostedTweetId: '6666666666666666666' });
      svc.logs.addLog(
        makeLog({ tweetId: '6666666666666666666', contextId: ctx.id, engagementMode: 'quote' }),
      );
      expect(svc.contexts.getContextLastPostedTweetId(ctx.id)).toBeUndefined();
    });

    it('persists lastPostedSlot without regenerating the queue', () => {
      const before = svc.queue.getQueue('ctx_primary').map((s) => s.slotId);
      svc.contexts.setContextLastPostedSlot('ctx_primary', '2026-01-01-06:00');
      expect(svc.contexts.getContext('ctx_primary')!.lastPostedSlot).toBe('2026-01-01-06:00');
      expect(svc.queue.getQueue('ctx_primary').map((s) => s.slotId)).toEqual(before);
    });
  });

  describe('queueService', () => {
    it('pops the next slot and tops the queue back up', () => {
      const first = svc.queue.getQueue('ctx_primary')[0];
      const color = svc.queue.popNextQueueSlot('morning', 'ctx_primary');
      expect(color.hex).toBe(first.color.hex);
      const queue = svc.queue.getQueue('ctx_primary');
      expect(queue).toHaveLength(14);
      expect(queue.some((s) => s.slotId === first.slotId)).toBe(false);
    });

    it('rerolls a slot in place and returns null for unknown ids', () => {
      const slot = svc.queue.getQueue('ctx_primary')[2];
      const rerolled = svc.queue.rerollQueueSlot(slot.slotId)!;
      expect(rerolled.slotId).toBe(slot.slotId);
      expect(rerolled.timeSlot).toBe(slot.timeSlot);
      expect(rerolled.previewText?.length).toBeGreaterThan(0);
      expect(svc.queue.rerollQueueSlot('slot_missing')).toBeNull();
    });

    it('builds fixed-time slots from the schedule times', () => {
      const ctx = svc.contexts.createContext({
        name: 'Fixed',
        targetTweetId: TWEET,
        schedule: {
          mode: 'fixed_times',
          scheduleTimes: ['06:00', '18:00'],
          intervalMinutes: 60,
          timezone: 'America/Denver',
          humanizeJitterEnabled: false,
          jitterPercentage: 0,
        },
      });
      const queue = svc.queue.getQueue(ctx.id);
      expect(queue.slice(0, 4).map((s) => s.timeSlot)).toEqual([
        '06:00',
        '18:00',
        '06:00',
        '18:00',
      ]);
      expect(queue[0].slotType).toBe('morning');
      expect(queue[1].slotType).toBe('evening');
    });

    it('drops legacy untagged slots on sync', async () => {
      const legacy = new MemoryStore({
        queue: [{ slotId: 'old', dateStr: '', timeSlot: '', slotType: 'morning' } as never],
      });
      const s2 = await createServices(legacy);
      expect(s2.queue.getQueue()).toHaveLength(14);
      expect(s2.queue.getQueue().some((q) => q.slotId === 'old')).toBe(false);
    });
  });

  describe('logService', () => {
    it('returns logs newest first and clears them', () => {
      svc.logs.addLog(makeLog({ id: 'a' }));
      svc.logs.addLog(makeLog({ id: 'b' }));
      expect(svc.logs.getLogs().map((l) => l.id)).toEqual(['b', 'a']);
      svc.logs.clearLogs();
      expect(svc.logs.getLogs()).toEqual([]);
    });

    it('clears one context history and resets its stats and anchors', () => {
      const ctx = svc.contexts.createContext({ name: 'A', targetTweetId: TWEET });
      svc.contexts.recordContextPostResult(ctx.id, 'success', '7777777777777777777');
      svc.logs.addLog(makeLog({ id: 'mine', contextId: ctx.id }));
      svc.logs.addLog(makeLog({ id: 'other', contextId: 'ctx_primary' }));
      const result = svc.logs.clearContextHistory(ctx.id);
      expect(result.clearedCount).toBe(1);
      expect(result.context?.stats?.totalPosts).toBe(0);
      expect(result.context?.lastPostedTweetId).toBeUndefined();
      expect(svc.logs.getLogs().map((l) => l.id)).toEqual(['other']);
    });

    it('treats logs without a contextId as primary when clearing the primary context', () => {
      svc.logs.addLog(makeLog({ id: 'legacy' }));
      svc.logs.addLog(makeLog({ id: 'keep', contextId: 'ctx_other' }));
      expect(svc.logs.clearContextHistory('ctx_primary').clearedCount).toBe(1);
    });
  });

  describe('settingsService', () => {
    it('mirrors the active context and writes updates through to it', () => {
      const updated = svc.settings.updateSettings({
        template: 'Hello {color_pick}',
        dryRun: true,
        intervalMinutes: 30,
      });
      expect(updated.template).toBe('Hello {color_pick}');
      expect(updated.dryRun).toBe(true);
      expect(updated.intervalMinutes).toBe(30);
      const active = svc.contexts.getActiveContext();
      expect(active.template).toBe('Hello {color_pick}');
      expect(active.schedule.intervalMinutes).toBe(30);
      expect(updated).not.toHaveProperty('webhookSecret');
    });

    it('rejects an unparseable target tweet id', () => {
      expect(() => svc.settings.updateSettings({ targetTweetId: 'garbage' })).toThrow(HttpError);
    });
  });

  describe('credentialService', () => {
    afterEach(() => vi.unstubAllEnvs());

    it('masks stored credentials and reports the source', () => {
      vi.stubEnv('TWITTER_API_KEY', '');
      svc.credentials.updateCredentials({
        apiKey: 'abcdefghij',
        apiSecret: 's',
        accessToken: 'tokentoken',
        accessTokenSecret: 'x',
      });
      const status = svc.credentials.getMaskedCredentialsStatus();
      expect(status.apiKeyMasked).toBe('abc••••hij');
      expect(status.authMethod).toBe('OAuth 1.0a (Permanent)');
      expect(status.source).toBe('server_config');
    });

    it('prefers environment variables over stored credentials', () => {
      svc.credentials.updateCredentials({ apiKey: 'stored' });
      vi.stubEnv('TWITTER_API_KEY', 'fromenv');
      expect(svc.credentials.getEffectiveCredentials().apiKey).toBe('fromenv');
      expect(svc.credentials.getMaskedCredentialsStatus().source).toBe('environment_variables');
    });

    it('rotates the webhook secret unless WEBHOOK_SECRET is set', () => {
      vi.stubEnv('WEBHOOK_SECRET', '');
      const first = svc.credentials.getWebhookSecret();
      const rotated = svc.credentials.rotateWebhookSecret();
      expect(rotated).not.toBe(first);
      vi.stubEnv('WEBHOOK_SECRET', 'pinned');
      expect(svc.credentials.getWebhookSecret()).toBe('pinned');
    });
  });

  describe('rateLimitService', () => {
    it('sets and clears the global cooldown', () => {
      expect(svc.rateLimit.getCooldownState().isThrottled).toBe(false);
      svc.rateLimit.setGlobalCooldown(10, 'testing');
      const state = svc.rateLimit.getCooldownState();
      expect(state.isThrottled).toBe(true);
      expect(state.reason).toBe('testing');
      expect(state.secondsRemaining).toBeGreaterThan(590);
      expect(svc.rateLimit.getRateLimitTelemetry().status).toBe('throttled');
      svc.rateLimit.clearGlobalCooldown();
      expect(svc.rateLimit.getCooldownState().isThrottled).toBe(false);
    });

    it('tracks time since the last live post', () => {
      expect(svc.rateLimit.getTimeSinceLastLivePostMs()).toBe(Infinity);
      svc.rateLimit.recordLivePostTimestamp();
      expect(svc.rateLimit.getTimeSinceLastLivePostMs()).toBeLessThan(1000);
    });

    it('detects the tier from captured headers and counts live posts in 24h', () => {
      svc.rateLimit.updateRateLimitTelemetry({ limit: 17, remaining: 3, appDailyLimit: 17 });
      svc.logs.addLog(makeLog({ tweetId: '123', status: 'success' }));
      svc.logs.addLog(makeLog({ tweetId: 'sim_1', status: 'success' }));
      const t = svc.rateLimit.getRateLimitTelemetry();
      expect(t.tierDetected).toBe('Free (Legacy)');
      expect(t.estimatedDailyCap).toBe(17);
      expect(t.postsLast24Hours).toBe(1);
      expect(t.status).toBe('warning');
      expect(t.headersCaptured).toBe(true);
    });

    it('ignores header sets without limit/remaining', () => {
      svc.rateLimit.updateRateLimitTelemetry({ retryAfter: 5 });
      expect(svc.rateLimit.getRateLimitTelemetry().headersCaptured).toBe(false);
    });
  });

  describe('persistence', () => {
    it('coalesces writes and flush() waits for them', async () => {
      await svc.flush();
      const base = store.saveCount;
      svc.logs.addLog(makeLog({ id: 'one' }));
      svc.logs.addLog(makeLog({ id: 'two' }));
      svc.logs.addLog(makeLog({ id: 'three' }));
      await svc.flush();
      expect(store.saveCount - base).toBeLessThanOrEqual(2);
      expect(store.snapshot()?.logs.map((l) => l.id)).toEqual(['one', 'two', 'three']);
    });

    it('keeps and persists at most MAX_LOGS (default 500) logs', async () => {
      for (let i = 0; i < 510; i++) svc.logs.addLog(makeLog({ id: `l${i}` }));
      await svc.flush();
      expect(store.snapshot()?.logs).toHaveLength(500);
      expect(store.snapshot()?.logs[0].id).toBe('l10');
      expect(svc.logs.getLogs()).toHaveLength(500);
    });

    it('restores state from the store on boot', async () => {
      svc.contexts.createContext({ name: 'Persisted', targetTweetId: TWEET });
      await svc.flush();
      const again = await createServices(store);
      expect(again.contexts.getContexts().map((c) => c.name)).toContain('Persisted');
    });

    it('repairs a polluted chain anchor on boot', async () => {
      const polluted = new MemoryStore({
        contexts: [
          {
            id: 'ctx_primary',
            name: 'P',
            targetTweetId: TWEET,
            enabled: true,
            schedule: {
              mode: 'interval',
              intervalMinutes: 15,
              scheduleTimes: ['06:00'],
              timezone: 'America/Denver',
              humanizeJitterEnabled: false,
              jitterPercentage: 0,
            },
            template: 't',
            themePreference: 'dynamic',
            lastPostedTweetId: 'not-numeric',
            autoFallbackToQuote: true,
          },
        ],
      });
      const s2 = await createServices(polluted);
      const ctx = s2.contexts.getContext('ctx_primary')!;
      expect(ctx.lastPostedTweetId).toBeUndefined();
      expect(ctx.autoFallbackToQuote).toBe(false);
    });
  });
});

describe('JsonFileStore', () => {
  it('round-trips state through bot-store.json and refuses a corrupt file', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chromabot-json-'));
    try {
      const nested = path.join(dir, 'nested');
      const file = new JsonFileStore(nested);
      expect((await file.load()).contexts).toEqual([]);

      const svc = await createServices(file);
      svc.contexts.createContext({ name: 'Disk', targetTweetId: TWEET });
      await svc.flush();
      expect(fs.existsSync(path.join(nested, 'bot-store.json'))).toBe(true);

      const reloaded = await createServices(new JsonFileStore(nested));
      expect(reloaded.contexts.getContexts().map((c) => c.name)).toContain('Disk');
      expect(reloaded.credentials.getWebhookSecret()).toBe(svc.credentials.getWebhookSecret());

      fs.writeFileSync(path.join(nested, 'bot-store.json'), '{not json');
      await expect(new JsonFileStore(nested).load()).rejects.toThrow(/ALLOW_FRESH_STORE/);
      expect((await new JsonFileStore(nested, { allowFreshStore: true }).load()).contexts).toEqual(
        [],
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
