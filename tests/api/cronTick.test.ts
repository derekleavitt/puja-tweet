import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../server/app.js';
import { scheduler } from '../../server/scheduler.js';
import { dropService } from '../../server/services/dropService.js';
import { services } from '../../server/services/index.js';
import { MemoryStore } from '../../server/store/MemoryStore.js';
import type { SchedulerMode } from '../../server/config.js';

// Never reach X or Gemini: executeDrop is always stubbed in these tests.
vi.mock('../../server/twitterClient.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../server/twitterClient.js')>()),
  postColorTweet: vi.fn(async () => {
    throw new Error('X must not be called from cronTick tests');
  }),
}));

const SECRET = 'tick-secret';
const HOUR = 3_600_000;

const makeTickApp = (
  extra: { cronSecret?: string; maxDropsPerTick?: number; schedulerMode?: SchedulerMode } = {},
) =>
  createApp({
    services,
    scheduler,
    drops: dropService,
    // Real auth stays on: the tick must be reachable with its own secret only.
    verifyToken: async () => {
      throw new Error('bad token');
    },
    authorizedEmails: [],
    cronSecret: SECRET,
    schedulerMode: 'interval',
    ...extra,
  });

/** Leaves exactly `count` enabled interval contexts, all overdue. */
const dueContexts = (count: number) => {
  for (const c of services.contexts.getContexts()) c.enabled = false;
  return Array.from({ length: count }, (_, i) => {
    const ctx = services.contexts.createContext({ name: `due ${i}`, enabled: true });
    ctx.lastPostedTimestamp = Date.now() - 24 * HOUR;
    ctx.currentJitterMs = 0;
    return ctx;
  });
};

beforeEach(async () => {
  services.settings.updateSettings({ globalPaused: false, globalDryRun: true });
  vi.spyOn(services.rateLimit, 'getTimeSinceLastLivePostMs').mockReturnValue(Infinity);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  await services.flush();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/cron/tick auth', () => {
  it('returns 503 when CRON_SECRET is not configured', async () => {
    const res = await request(makeTickApp({ cronSecret: '' }))
      .post('/api/cron/tick')
      .set('x-cron-secret', 'anything')
      .expect(503);
    expect(res.body).toEqual({ success: false, error: expect.any(String) });
  });

  it('returns 401 for a missing or wrong secret, without a Firebase token', async () => {
    const app = makeTickApp();
    const exec = vi.spyOn(dropService, 'executeDrop');
    await request(app).post('/api/cron/tick').expect(401);
    const res = await request(app).post('/api/cron/tick').set('x-cron-secret', 'nope').expect(401);
    expect(res.body).toEqual({ success: false, error: expect.any(String) });
    expect(exec).not.toHaveBeenCalled();
  });

  it('accepts the secret in place of an ID token, while other routes still need one', async () => {
    const app = makeTickApp();
    await request(app).post('/api/cron/tick').set('x-cron-secret', SECRET).expect(200);
    await request(app).get('/api/status').expect(401);
  });
});

describe('POST /api/cron/tick behaviour', () => {
  it('runs one tick, awaits the drop and reports fired/skipped/durationMs', async () => {
    // Live mode: the anti-burst spacing only gates drops that would really reach X.
    services.settings.updateSettings({ globalDryRun: false });
    const [due] = dueContexts(2);
    let finished = false;
    const exec = vi
      .spyOn(dropService, 'executeDrop')
      .mockImplementation(async (args?: { contextId?: string }) => {
        await new Promise((r) => setTimeout(r, 20));
        services.contexts.getContext(args!.contextId!)!.lastPostedTimestamp = Date.now();
        finished = true;
        vi.mocked(services.rateLimit.getTimeSinceLastLivePostMs).mockReturnValue(0); // anti-burst
        return {} as never;
      });
    const res = await request(makeTickApp()).post('/api/cron/tick').set('x-cron-secret', SECRET);
    expect(res.status).toBe(200);
    expect(finished).toBe(true);
    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledWith({ contextId: due.id, source: 'scheduler' });
    expect(res.body).toEqual({
      success: true,
      fired: 1,
      skipped: 1,
      durationMs: expect.any(Number),
    });
  });

  it('caps drops per tick; the remainder fires on the next tick', async () => {
    const ctxs = dueContexts(3);
    vi.spyOn(dropService, 'executeDrop').mockImplementation(
      async (args?: { contextId?: string }) => {
        services.contexts.getContext(args!.contextId!)!.lastPostedTimestamp = Date.now();
        return {} as never;
      },
    );
    const app = makeTickApp({ maxDropsPerTick: 2 });
    const first = await request(app).post('/api/cron/tick').set('x-cron-secret', SECRET);
    expect(first.body).toMatchObject({ fired: 2, skipped: 1 });
    const second = await request(app).post('/api/cron/tick').set('x-cron-secret', SECRET);
    expect(second.body).toMatchObject({ fired: 1 });
    expect(ctxs.every((c) => Date.now() - c.lastPostedTimestamp! < HOUR)).toBe(true);
  });

  it('answers 409 while another tick is in flight', async () => {
    dueContexts(1);
    let release!: () => void;
    vi.spyOn(dropService, 'executeDrop').mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve({} as never);
      }),
    );
    const running = scheduler.tick();
    const res = await request(makeTickApp()).post('/api/cron/tick').set('x-cron-secret', SECRET);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ success: false, error: expect.any(String) });
    release();
    await running;
  });

  it('works in interval mode and honours global pause', async () => {
    dueContexts(1);
    services.settings.updateSettings({ globalPaused: true });
    const exec = vi.spyOn(dropService, 'executeDrop');
    const res = await request(makeTickApp()).post('/api/cron/tick').set('x-cron-secret', SECRET);
    expect(res.body).toMatchObject({ success: true, fired: 0 });
    expect(exec).not.toHaveBeenCalled();
  });
});

describe('serverless persistence', () => {
  it('an idle tick causes zero store saves', async () => {
    for (const c of services.contexts.getContexts()) c.lastPostedTimestamp = Date.now();
    await services.flush();
    const save = vi.spyOn(MemoryStore.prototype, 'save');
    const res = await request(makeTickApp({ schedulerMode: 'external' }))
      .post('/api/cron/tick')
      .set('x-cron-secret', SECRET)
      .expect(200);
    expect(res.body).toMatchObject({ fired: 0 });
    expect(save).not.toHaveBeenCalled();
  });

  it('GET requests never write', async () => {
    await services.flush();
    const save = vi.spyOn(MemoryStore.prototype, 'save');
    const app = createApp({ services, scheduler, drops: dropService, authDisabled: true });
    for (const path of [
      '/api/status',
      '/api/contexts',
      '/api/queue',
      '/api/history',
      '/api/health',
    ]) {
      await request(app).get(path);
    }
    await services.flush();
    expect(save).not.toHaveBeenCalled();
  });

  const toggleDryRun = async (mode: SchedulerMode) => {
    const save = vi.spyOn(MemoryStore.prototype, 'save');
    const app = createApp({
      services,
      scheduler,
      drops: dropService,
      authDisabled: true,
      schedulerMode: mode,
    });
    const next = !services.settings.getSettings().globalDryRun;
    await request(app).post('/api/settings').send({ globalDryRun: next }).expect(200);
    return save.mock.calls.length;
  };

  it('external mode flushes before a non-GET response is sent', async () => {
    expect(await toggleDryRun('external')).toBeGreaterThanOrEqual(1);
  });

  it('interval mode keeps the debounced save (not yet written at response time)', async () => {
    expect(await toggleDryRun('interval')).toBe(0);
    await services.flush();
  });
});
