import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scheduler } from '../../server/scheduler.js';
import { createDropService, dropService } from '../../server/services/dropService.js';
import { createServices, services } from '../../server/services/index.js';
import { MemoryStore } from '../../server/store/MemoryStore.js';

type Evaluate = (c: unknown, n: number) => Promise<void>;
const evaluate = (c: unknown, n: number) =>
  (scheduler as unknown as { evaluateContextSchedule: Evaluate }).evaluateContextSchedule(c, n);

const HOUR = 3_600_000;

/** Leaves exactly the given number of enabled interval contexts, all overdue. */
const dueContexts = (count: number) => {
  for (const c of services.contexts.getContexts()) c.enabled = false;
  return Array.from({ length: count }, (_, i) => {
    const ctx = services.contexts.createContext({ name: `due ${i}`, enabled: true });
    ctx.lastPostedTimestamp = Date.now() - 24 * HOUR;
    ctx.currentJitterMs = 0;
    return ctx;
  });
};

beforeEach(() => {
  services.settings.updateSettings({ globalPaused: false, globalDryRun: false });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('tick watchdog', () => {
  it('releases the lock when a drop hangs past the deadline', async () => {
    vi.useFakeTimers();
    vi.stubEnv('SCHEDULER_TICK_TIMEOUT_MS', '1000');
    dueContexts(1);
    const exec = vi.spyOn(dropService, 'executeDrop').mockReturnValue(new Promise(() => {}));
    const first = scheduler.tick();
    await vi.advanceTimersByTimeAsync(500);
    await scheduler.tick(); // still locked: ignored
    expect(exec).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(600);
    await first;
    expect((scheduler as unknown as { isProcessing: boolean }).isProcessing).toBe(false);
    await vi.advanceTimersByTimeAsync(0);
    const second = scheduler.tick(); // lock released: a new tick runs
    await vi.advanceTimersByTimeAsync(1100);
    await second;
    expect(exec).toHaveBeenCalledTimes(2);
  });
});

describe('per-post anti-burst', () => {
  it('fires at most one live drop per 60 s even when several contexts are due', async () => {
    dueContexts(3);
    const exec = vi.spyOn(dropService, 'executeDrop').mockImplementation(async () => {
      services.rateLimit.recordLivePostTimestamp();
      return {} as never;
    });
    await scheduler.tick();
    expect(exec).toHaveBeenCalledTimes(1);
    await scheduler.tick(); // next tick, still inside the 60 s spacing
    expect(exec).toHaveBeenCalledTimes(1);
  });
});

describe('no immediate fire', () => {
  it('a new context starts its interval from now', async () => {
    dueContexts(1);
    const fresh = services.contexts.createContext({ name: 'fresh', enabled: true });
    expect(Math.abs(fresh.lastPostedTimestamp! - Date.now())).toBeLessThan(1000);
    vi.spyOn(services.rateLimit, 'getTimeSinceLastLivePostMs').mockReturnValue(Infinity);
    const exec = vi.spyOn(dropService, 'executeDrop').mockResolvedValue({} as never);
    await evaluate(fresh, Date.now() + 10_000);
    expect(exec).not.toHaveBeenCalled();
    await evaluate(fresh, Date.now() + 90 * 60_000);
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it('a legacy context stored with 0 gets its clock started instead of firing', async () => {
    const [ctx] = dueContexts(1);
    ctx.lastPostedTimestamp = 0;
    const exec = vi.spyOn(dropService, 'executeDrop').mockResolvedValue({} as never);
    await evaluate(ctx, Date.now());
    expect(exec).not.toHaveBeenCalled();
    expect(ctx.lastPostedTimestamp).toBeGreaterThan(0);
  });

  it('re-enabling restarts the interval and clears the auto-pause state', () => {
    const [ctx] = dueContexts(1);
    ctx.enabled = false;
    ctx.autoPausedReason = 'x';
    ctx.consecutiveErrors = 5;
    const resumed = services.contexts.toggleContext(ctx.id);
    expect(resumed.enabled).toBe(true);
    expect(resumed.autoPausedReason).toBeUndefined();
    expect(resumed.consecutiveErrors).toBe(0);
    expect(Date.now() - resumed.lastPostedTimestamp!).toBeLessThan(1000);
  });
});

describe('circuit breaker', () => {
  const fail = (svc: Awaited<ReturnType<typeof createServices>>, id: string, cls = 'unknown') =>
    svc.contexts.recordContextPostResult(id, 'error', undefined, 'reply', {
      errorClass: cls as never,
      message: 'boom',
    });

  it('auto-pauses after 5 consecutive errors, not before', async () => {
    const svc = await createServices(new MemoryStore());
    const id = svc.contexts.createContext({ name: 'c', enabled: true }).id;
    for (let i = 0; i < 4; i++) expect(fail(svc, id).autoPausedReason).toBeUndefined();
    expect(svc.contexts.getContext(id)!.enabled).toBe(true);
    const out = fail(svc, id);
    expect(out.autoPausedReason).toContain('5 consecutive errors');
    const ctx = svc.contexts.getContext(id)!;
    expect(ctx.enabled).toBe(false);
    expect(ctx.autoPausedReason).toBe(out.autoPausedReason);
  });

  it('a success resets the streak; 429 and cooldown errors do not count', async () => {
    const svc = await createServices(new MemoryStore());
    const id = svc.contexts.createContext({ name: 'c', enabled: true }).id;
    for (let i = 0; i < 4; i++) fail(svc, id);
    svc.contexts.recordContextPostResult(id, 'success', '1');
    for (let i = 0; i < 4; i++) fail(svc, id);
    for (let i = 0; i < 10; i++) fail(svc, id, i % 2 ? 'rate_limit' : 'cooldown');
    expect(svc.contexts.getContext(id)!.enabled).toBe(true);
    expect(svc.contexts.getContext(id)!.consecutiveErrors).toBe(4);
  });

  it.each(['auth', 'payment'])('pauses immediately on %s errors', async (cls) => {
    const svc = await createServices(new MemoryStore());
    const id = svc.contexts.createContext({ name: 'c', enabled: true }).id;
    expect(fail(svc, id, cls).autoPausedReason).toMatch(/40[12]/);
    expect(svc.contexts.getContext(id)!.enabled).toBe(false);
  });

  it('records the pause reason in the drop log (stubbed X 401)', async () => {
    const svc = await createServices(new MemoryStore());
    const ctx = svc.contexts.requireActiveContext();
    svc.contexts.patchContext(ctx.id, { dryRun: false, enabled: true });
    const drops = createDropService({
      services: svc,
      postColorTweet: vi.fn().mockResolvedValue({
        success: false,
        error: 'Unauthorized',
        httpStatus: 401,
        rawResponse: {},
      }) as never,
      resolveTemplateText: vi.fn().mockResolvedValue('hi') as never,
    });
    const out = await drops.executeDrop({ contextId: ctx.id, slotType: 'morning' });
    expect(out.log.errorMessage).toContain('auto-paused');
    expect(svc.contexts.getContext(ctx.id)).toMatchObject({ enabled: false });
    expect(svc.contexts.getContext(ctx.id)!.autoPausedReason).toContain('401');
  });
});

describe('queue top-up', () => {
  it('refills a drained queue during the tick, even while paused', async () => {
    services.settings.updateSettings({ globalPaused: true });
    const state = (services.queue as unknown as { sm: { state: { queue: unknown[] } } }).sm.state;
    state.queue.length = 0;
    expect(services.queue.getQueue()).toHaveLength(0);
    await scheduler.tick();
    expect(services.queue.getQueue().length).toBeGreaterThan(0);
  });
});
