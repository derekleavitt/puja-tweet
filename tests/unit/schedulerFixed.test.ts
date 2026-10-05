import { afterEach, describe, expect, it, vi } from 'vitest';
import { scheduler } from '../../server/scheduler.js';
import { dropService } from '../../server/services/dropService.js';
import { createServices, services } from '../../server/services/index.js';
import { MemoryStore } from '../../server/store/MemoryStore.js';
import type { TweetContext } from '../../shared/types.js';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function setup(times: string[], jitterMs: number) {
  const ctx = services.contexts.patchContext(services.contexts.requireActiveContext().id, {
    enabled: true,
    schedule: {
      mode: 'fixed_times',
      intervalMinutes: 60,
      scheduleTimes: times,
      timezone: 'America/Denver',
      humanizeJitterEnabled: jitterMs > 0,
      jitterPercentage: 25,
    },
    lastPostedSlot: undefined,
  });
  ctx.currentJitterMs = jitterMs;
  return ctx;
}

describe('fixed-time evaluation', () => {
  it('fires "6:00" at 06:00 local exactly once per day, tagged morning', async () => {
    const ctx = setup(['6:00'], 0);
    const exec = vi.spyOn(dropService, 'executeDrop').mockResolvedValue({} as never);
    const evaluate = (t: string) =>
      (
        scheduler as unknown as {
          evaluateContextSchedule: (c: unknown, n: number) => Promise<void>;
        }
      ).evaluateContextSchedule(ctx, Date.parse(t));

    await evaluate('2026-03-08T11:59:50Z'); // 05:59 MDT (post spring-forward)
    expect(exec).not.toHaveBeenCalled();
    await evaluate('2026-03-08T12:00:10Z');
    await evaluate('2026-03-08T12:00:40Z');
    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec.mock.calls[0][0]).toMatchObject({ slotType: 'morning' });
    expect(ctx.lastPostedSlot).toBe('2026-03-08-06:00');
  });

  it('delays the fire by currentJitterMs', async () => {
    const ctx = setup(['18:00'], 90_000);
    const exec = vi.spyOn(dropService, 'executeDrop').mockResolvedValue({} as never);
    const evaluate = (t: number) =>
      (
        scheduler as unknown as {
          evaluateContextSchedule: (c: unknown, n: number) => Promise<void>;
        }
      ).evaluateContextSchedule(ctx, t);

    const start = Date.parse('2026-11-01T00:00:05Z'); // 18:00 MDT on Oct 31
    await evaluate(start);
    await evaluate(start + 60_000);
    expect(exec).not.toHaveBeenCalled();
    await evaluate(start + 91_000); // past the minute, still fires
    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec.mock.calls[0][0]).toMatchObject({ slotType: 'evening' });
    await evaluate(start + 100_000);
    expect(exec).toHaveBeenCalledTimes(1);
  });
});

describe('pending jittered fire across a restart (BUG-1)', () => {
  const evaluate = (c: unknown, t: number) =>
    (
      scheduler as unknown as {
        evaluateContextSchedule: (c: unknown, n: number) => Promise<void>;
      }
    ).evaluateContextSchedule(c, t);

  it('fires exactly once when the process restarts inside the jitter window', async () => {
    const ctx = setup(['18:00'], 90_000);
    const exec = vi.spyOn(dropService, 'executeDrop').mockResolvedValue({} as never);
    const start = Date.parse('2026-11-01T00:00:05Z');
    await evaluate(ctx, start);
    expect(ctx.pendingFire).toMatchObject({ slotKey: '2026-10-31-18:00', fireAt: start + 90_000 });

    // "Restart": a fresh copy of the persisted context, with no scheduler memory.
    const restarted = structuredClone(ctx) as TweetContext;
    await evaluate(restarted, start + 30_000);
    expect(exec).not.toHaveBeenCalled();
    await evaluate(restarted, start + 91_000);
    await evaluate(restarted, start + 100_000);
    expect(exec).toHaveBeenCalledTimes(1);
    expect(restarted.pendingFire).toBeUndefined();
    expect(services.contexts.getContext(ctx.id)?.lastPostedSlot).toBe('2026-10-31-18:00');
  });

  it('drops a stale pending fire instead of firing hours late', async () => {
    const ctx = setup(['18:00'], 90_000);
    const exec = vi.spyOn(dropService, 'executeDrop').mockResolvedValue({} as never);
    const start = Date.parse('2026-11-01T00:00:05Z');
    await evaluate(ctx, start);
    await evaluate(structuredClone(ctx), start + 3 * 3_600_000);
    expect(exec).not.toHaveBeenCalled();
  });

  it('persists pendingFire through the store', async () => {
    const store = new MemoryStore();
    const first = await createServices(store);
    const id = first.contexts.requireActiveContext().id;
    const pending = {
      slotKey: '2026-10-31-18:00',
      slotType: 'evening' as const,
      matchedTime: '18:00',
      fireAt: 123,
    };
    first.contexts.setContextPendingFire(id, pending);
    await first.flush();
    const second = await createServices(store);
    expect(second.contexts.getContext(id)?.pendingFire).toEqual(pending);
  });
});
