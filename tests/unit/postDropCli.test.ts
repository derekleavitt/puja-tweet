import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDropService } from '../../server/services/dropService.js';
import { createServices, type Services } from '../../server/services/index.js';
import { MemoryStore } from '../../server/store/MemoryStore.js';
import { parseArgs, runPostDrop } from '../../scripts/postDropCli.js';

let svc: Services;
const post = vi.fn();
const resolveText = vi.fn();

const run = (args: string[], env: NodeJS.ProcessEnv = {}, now = new Date('2026-07-01T12:30:00Z')) =>
  runPostDrop(parseArgs(args), {
    drops: createDropService({
      services: svc,
      postColorTweet: post as never,
      resolveTemplateText: resolveText as never,
    }),
    services: svc,
    env,
    now,
  });

const openSwitches = () =>
  svc.settings.updateSettings({ globalDryRun: false, globalPaused: false });

beforeEach(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  svc = await createServices(new MemoryStore());
  post
    .mockReset()
    .mockImplementation(async (_c, _o, isDryRun: boolean) =>
      isDryRun
        ? { success: true, simulated: true, tweetId: 'sim_1' }
        : { success: true, tweetId: '999', url: 'https://x.com/i/status/999' },
    );
  resolveText.mockReset().mockResolvedValue('hello');
});

describe('parseArgs', () => {
  it('parses context, slot, dry-run, live and force', () => {
    expect(parseArgs(['--context', 'ctx_a', '--slot', 'Evening', '--dry-run', '--force'])).toEqual({
      contextId: 'ctx_a',
      slot: 'evening',
      dryRun: true,
      force: true,
    });
    expect(parseArgs(['--live']).dryRun).toBe(false);
    expect(parseArgs([])).toEqual({ slot: 'auto' });
  });
});

describe('post-drop CLI over dropService', () => {
  it('defaults to a dry run through dropService and logs to the store', async () => {
    openSwitches();
    const code = await run([]);
    expect(code).toBe(0);
    expect(post.mock.calls[0][2]).toBe(true);
    expect(svc.logs.getLogs()[0]).toMatchObject({
      status: 'simulated',
      tweetText: 'hello #eternal #colors',
    });
  });

  it('honours the DRY_RUN=false env only as a live request, still behind the window guard', async () => {
    openSwitches();
    // 12:30 UTC in July is 06:30 America/Denver: inside the window after 06:00.
    expect(await run([], { DRY_RUN: 'false' })).toBe(0);
    expect(post.mock.calls[0][2]).toBe(false);
  });

  it('--dry-run works while the global pause and dry-run defaults are on', async () => {
    expect(svc.settings.isGlobalPaused()).toBe(true);
    expect(await run(['--dry-run'])).toBe(0);
    expect(post.mock.calls[0][2]).toBe(true);
  });

  it('--live is refused (exit 1, no post) while globally paused', async () => {
    svc.settings.updateSettings({ globalDryRun: false });
    expect(await run(['--live', '--slot', 'morning'])).toBe(1);
    expect(post).not.toHaveBeenCalled();
  });

  it('--live under global dry-run is simulated and exits 1', async () => {
    svc.settings.updateSettings({ globalPaused: false });
    expect(await run(['--live', '--slot', 'morning'])).toBe(1);
    expect(post.mock.calls[0][2]).toBe(true);
  });

  it('--live with the switches off posts live using the campaign engagement mode', async () => {
    openSwitches();
    const id = svc.contexts.requireActiveContext().id;
    svc.contexts.patchContext(id, { engagementMode: 'quote', targetTweetId: '111' });
    expect(await run(['--live', '--slot', 'morning'])).toBe(0);
    expect(post.mock.calls[0][1]).toMatchObject({ quoteTweetId: '111', engagementMode: 'quote' });
    expect(post.mock.calls[0][2]).toBe(false);
  });

  it('refuses a live auto-slot run outside the schedule window unless --force', async () => {
    openSwitches();
    const outside = new Date('2026-07-01T20:00:00Z'); // 14:00 Denver
    expect(await run(['--live'], {}, outside)).toBe(1);
    expect(post).not.toHaveBeenCalled();
    expect(await run(['--live', '--force'], {}, outside)).toBe(0);
  });

  it('targets --context and fails on an unknown id', async () => {
    openSwitches();
    const other = svc.contexts.createContext({ name: 'Other', targetTweetId: '222' });
    expect(await run(['--dry-run', '--context', other.id])).toBe(0);
    expect(svc.logs.getLogs()[0].contextId).toBe(other.id);
    expect(await run(['--dry-run', '--context', 'nope'])).toBe(1);
  });

  it('exits 1 when the post fails', async () => {
    openSwitches();
    post.mockResolvedValue({ success: false, error: 'boom', httpStatus: 500 });
    expect(await run(['--live', '--slot', 'evening'])).toBe(1);
    expect(svc.logs.getLogs()[0].status).toBe('error');
  });
});
