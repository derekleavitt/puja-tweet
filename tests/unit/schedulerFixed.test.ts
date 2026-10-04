import { afterEach, describe, expect, it, vi } from 'vitest';
import { scheduler } from '../../server/scheduler.js';
import { storage } from '../../server/storage.js';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function setup(times: string[], jitterMs: number) {
  const ctx = storage.updateContext(storage.getActiveContext().id, {
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
    const exec = vi.spyOn(scheduler, 'executeDrop').mockResolvedValue({} as never);
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
    const exec = vi.spyOn(scheduler, 'executeDrop').mockResolvedValue({} as never);
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
