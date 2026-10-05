import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scheduler } from '../../server/scheduler.js';
import { generateJitterForContext } from '../../server/services/contextChain.js';
import { dropService } from '../../server/services/dropService.js';
import { services } from '../../server/services/index.js';

const oneMinuteCampaign = (lastPostedAgoMs: number) => {
  for (const c of services.contexts.getContexts()) c.enabled = false;
  const ctx = services.contexts.createContext({ name: 'every minute', enabled: true });
  ctx.schedule = { ...ctx.schedule, mode: 'interval', intervalMinutes: 1 };
  ctx.lastPostedTimestamp = Date.now() - lastPostedAgoMs;
  ctx.currentJitterMs = 0;
  return ctx;
};

beforeEach(() => {
  services.settings.updateSettings({ globalPaused: false, globalDryRun: true });
  services.rateLimit.clearGlobalCooldown();
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

describe('scheduler blocked reasons', () => {
  it('explains a global pause and does not fire', async () => {
    const ctx = oneMinuteCampaign(5 * 60_000);
    services.settings.updateSettings({ globalPaused: true });
    const exec = vi.spyOn(dropService, 'executeDrop').mockResolvedValue(undefined as never);
    await scheduler.tick();
    expect(exec).not.toHaveBeenCalled();
    expect(scheduler.getNextScheduledPost(ctx.id)?.blockedReason).toMatch(/Paused/);
  });

  it('explains a paused campaign', () => {
    const ctx = oneMinuteCampaign(0);
    ctx.enabled = false;
    expect(scheduler.getBlockedReason(ctx)).toMatch(/Campaign is paused/);
  });

  it('explains an active cooldown', () => {
    const ctx = oneMinuteCampaign(0);
    services.rateLimit.setGlobalCooldown(15, 'reply cooldown');
    expect(scheduler.getBlockedReason(ctx)).toMatch(/X cooldown: 15m left/);
  });

  it('has no reason when the scheduler is free to post', () => {
    const ctx = oneMinuteCampaign(0);
    expect(scheduler.getBlockedReason(ctx)).toBeUndefined();
  });
});

describe('1-minute interval timing', () => {
  it('fires a 1-minute campaign on a tick that arrives slightly early', async () => {
    oneMinuteCampaign(57_000); // tick drift: 57 s since the last post
    const exec = vi.spyOn(dropService, 'executeDrop').mockResolvedValue(undefined as never);
    await scheduler.tick();
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it('adds no random delay to intervals under 5 minutes', () => {
    const ctx = oneMinuteCampaign(0);
    ctx.schedule = { ...ctx.schedule, humanizeJitterEnabled: true };
    expect(generateJitterForContext(ctx)).toBe(0);
  });
});
