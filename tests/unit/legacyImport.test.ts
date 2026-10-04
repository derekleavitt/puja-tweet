import { describe, expect, it } from 'vitest';
import {
  formatReport,
  mapLegacyLog,
  mergeLegacyData,
  type LegacyData,
} from '../../server/migration/legacyImport.js';
import { createDefaultState } from '../../server/store/defaults.js';

const NOW = '2026-10-04T00:00:00.000Z';

const legacy = (): LegacyData => ({
  contexts: [
    {
      id: 'ctx_primary',
      data: {
        id: 'ctx_primary',
        name: 'Primary Eternal Colors',
        targetTweetId: 'https://x.com/someone/status/2103110008212992249',
        replyTargetMode: 'last_comment',
        engagementMode: 'quote',
        autoFallbackToQuote: true,
        lastPostedTweetId: '2103110008212992250',
        enabled: true,
        dryRun: false,
        schedule: {
          mode: 'fixed_times',
          intervalMinutes: 60,
          scheduleTimes: ['6:00', '18:5', 'bogus'],
          timezone: 'MST',
          humanizeJitterEnabled: false,
          jitterPercentage: 10,
        },
        template: 'Hello {color_pick}',
        themePreference: 'poetic',
        authorEmail: 'owner@example.com',
        updatedAt: '2026-01-01T00:00:00.000Z',
        webhookSecret: 'shh',
      },
    },
    { id: 'ctx_sparse', data: { name: 'Sparse', enabled: true } },
  ],
  postLogs: [
    {
      id: 'autoA',
      data: {
        id: 'log_1',
        timestamp: '2026-03-01T06:00:00.000Z',
        slotType: 'morning',
        targetTweetId: '2103110008212992249',
        tweetText: 'hi',
        status: 'success',
        color: { hex: '#ff0000', name: 'Red' },
        authorEmail: 'owner@example.com',
        syncedAt: 'x',
      },
    },
    {
      id: 'log_2',
      data: {
        timestamp: { _seconds: 1772000000 },
        slotType: 'weird',
        tweetText: 't',
        status: 'simulated',
      },
    },
    { id: 'bad', data: { slotType: 'morning', status: 'success' } },
  ],
  settings: { targetTweetId: '2103110008212992249', webhookSecret: 'shh', schedulerEnabled: true },
});

describe('legacy import', () => {
  it('maps and normalises contexts, forcing paused + dry-run', () => {
    const { state, report } = mergeLegacyData(createDefaultState(), legacy(), NOW);
    const primary = state.contexts.find((c) => c.id === 'ctx_primary')!;
    expect(primary.enabled).toBe(false);
    expect(primary.dryRun).toBe(true);
    expect(primary.targetTweetId).toBe('2103110008212992249');
    expect(primary.lastPostedTweetId).toBe('2103110008212992250');
    expect(primary.replyTargetMode).toBe('last_comment');
    expect(primary.engagementMode).toBe('quote');
    expect(primary.schedule.scheduleTimes).toEqual(['06:00', '18:05']);
    expect(primary.schedule.timezone).toBe('America/Denver');
    expect(primary.schedule.mode).toBe('fixed_times');
    expect(primary.template).toBe('Hello {color_pick}');
    expect(report.warnings.join('\n')).toMatch(/was enabled, imported PAUSED/);
    expect(report.warnings.join('\n')).toMatch(/imported as DRY-RUN/);

    const sparse = state.contexts.find((c) => c.id === 'ctx_sparse')!;
    expect(sparse.enabled).toBe(false);
    expect(sparse.dryRun).toBe(true);
    expect(sparse.themePreference).toBe('dynamic');
    expect(sparse.schedule.scheduleTimes.length).toBeGreaterThan(0);
    expect(sparse.template).toBeTruthy();
    expect(report.contexts).toEqual({ found: 2, added: 2, skipped: 0 });
  });

  it('never imports secrets or identities', () => {
    const { state, report } = mergeLegacyData(createDefaultState(), legacy(), NOW);
    const dump = JSON.stringify(state);
    expect(dump).not.toContain('shh');
    expect(dump).not.toContain('owner@example.com');
    expect(state.settings.webhookSecret).toBeUndefined();
    expect(report.warnings.some((w) => /dropped secret field\(s\) webhookSecret/.test(w))).toBe(
      true,
    );
  });

  it('maps logs, skips unusable ones, and keeps them oldest-first', () => {
    const { state, report } = mergeLegacyData(createDefaultState(), legacy(), NOW);
    expect(report.logs).toMatchObject({ found: 3, added: 2, skipped: 1 });
    expect(state.logs.map((l) => l.id)).toEqual(['log_2', 'log_1']);
    expect(state.logs[0].slotType).toBe('manual');
    expect(state.logs[0].status).toBe('simulated');
    expect(state.logs[1].color.hex).toBe('#ff0000');
    expect(state.logs[1].color.rgb).toBeTruthy();
  });

  it('is idempotent and never overwrites existing ids', () => {
    const first = mergeLegacyData(createDefaultState(), legacy(), NOW).state;
    first.contexts[0] = {
      ...first.contexts[0],
      name: 'Renamed locally',
      enabled: true,
      dryRun: false,
    };
    const second = mergeLegacyData(first, legacy(), NOW);
    expect(second.report.contexts).toEqual({ found: 2, added: 0, skipped: 2 });
    expect(second.report.logs.added).toBe(0);
    expect(second.state.contexts).toEqual(first.contexts);
    expect(second.state.logs).toEqual(first.logs);
  });

  it('does not mutate its input or touch the master switches', () => {
    const base = createDefaultState();
    const { state } = mergeLegacyData(base, legacy(), NOW);
    expect(base.contexts).toHaveLength(0);
    expect(base.logs).toHaveLength(0);
    expect(state.settings.globalDryRun).toBe(true);
    expect(state.settings.globalPaused).toBe(true);
  });

  it('builds a paused dry-run ctx_primary from legacy settings when no contexts exist', () => {
    const { state, report } = mergeLegacyData(
      createDefaultState(),
      {
        contexts: [],
        postLogs: [],
        settings: {
          targetTweetId: '2103110008212992249',
          scheduleTimes: ['7:30'],
          timezone: 'America/Denver',
          schedulerEnabled: true,
          dryRun: false,
          webhookSecret: 'shh',
        },
      },
      NOW,
    );
    expect(state.contexts).toHaveLength(1);
    expect(state.contexts[0]).toMatchObject({ id: 'ctx_primary', enabled: false, dryRun: true });
    expect(state.contexts[0].schedule.scheduleTimes).toEqual(['07:30']);
    expect(state.settings.targetTweetId).toBe('2103110008212992249');
    expect(report.notes.join('\n')).toMatch(/settings\/global_settings/);
  });

  it('formats a summary table and states whether anything was written', () => {
    const { report } = mergeLegacyData(createDefaultState(), legacy(), NOW);
    expect(formatReport(report, false)).toMatch(/contexts\s+2\s+2\s+0[\s\S]*DRY RUN/);
    expect(formatReport(report, true)).toMatch(/APPLIED/);
  });

  it('rejects logs with an invalid status', () => {
    const warnings: string[] = [];
    expect(mapLegacyLog('x', { timestamp: NOW, status: 'nope' }, warnings)).toBeNull();
    expect(warnings).toHaveLength(1);
  });
});
