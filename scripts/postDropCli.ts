/**
 * Logic of the `post-drop` CLI (GitHub Actions / local runs).
 * A thin shell over `dropService.executeDrop`, the same code path the server uses, so engagement
 * mode, chain mode, `<agent>` templates, the length guard, global switches and logging all match.
 * Safety defaults (REL-1): dry run unless `--live` or `DRY_RUN=false`; live `--slot auto` runs are
 * refused outside the SCHEDULE_TIMES window unless `--force`.
 */

import fs from 'fs';
import { resolveTimezone } from '../shared/time.js';
import type { DropService } from '../server/services/dropService.js';
import type { Services } from '../server/services/index.js';

export interface CliOptions {
  slot: 'morning' | 'evening' | 'auto';
  contextId?: string;
  /** true = `--dry-run`, false = `--live`, undefined = decided by the DRY_RUN env var. */
  dryRun?: boolean;
  force?: boolean;
}

export interface PostDropDeps {
  drops: Pick<DropService, 'executeDrop'>;
  services: Pick<Services, 'settings' | 'contexts' | 'credentials'>;
  env?: NodeJS.ProcessEnv;
  now?: Date;
}

export function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = { slot: 'auto' };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--slot' && args[i + 1]) {
      const val = args[i + 1].toLowerCase();
      if (val === 'morning' || val === 'evening' || val === 'auto') options.slot = val;
      i++;
    } else if (arg === '--context' && args[i + 1]) {
      options.contextId = args[i + 1];
      i++;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--live') {
      options.dryRun = false;
    } else if (arg === '--force') {
      options.force = true;
    }
  }
  return options;
}

/** Actions keeps no state, so live `--slot auto` runs are limited to a window after a schedule time. */
const WINDOW_MINUTES = 60;

export function isWithinScheduleWindow(env: NodeJS.ProcessEnv, now: Date): boolean {
  const times = (env.SCHEDULE_TIMES || '06:00,18:00').split(',').map((s) => s.trim());
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: resolveTimezone(env.SCHEDULE_TIMEZONE),
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const nowMin =
    Number(parts.find((p) => p.type === 'hour')?.value) * 60 +
    Number(parts.find((p) => p.type === 'minute')?.value);
  return times.some((t) => {
    const [h, m] = t.split(':').map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return false;
    return (nowMin - (h * 60 + m) + 1440) % 1440 < WINDOW_MINUTES;
  });
}

const writeSummary = (md: string, env: NodeJS.ProcessEnv) => {
  if (!env.GITHUB_STEP_SUMMARY) return;
  try {
    fs.appendFileSync(env.GITHUB_STEP_SUMMARY, md);
  } catch (e) {
    console.warn('Could not write to GITHUB_STEP_SUMMARY:', e);
  }
};

/** Runs one drop and returns the process exit code (1 on error or simulated-without-dry-run). */
export async function runPostDrop(options: CliOptions, deps: PostDropDeps): Promise<number> {
  const env = deps.env ?? process.env;
  const { services } = deps;
  const wantLive = options.dryRun === undefined ? env.DRY_RUN === 'false' : !options.dryRun;

  const context = options.contextId
    ? services.contexts.getContext(options.contextId)
    : services.contexts.getActiveContext();
  if (!context) {
    console.error(`[PostDrop] Context "${options.contextId}" not found.`);
    return 1;
  }
  const creds = services.credentials.getEffectiveCredentials();
  const hasAuth = !!(
    (creds.apiKey && creds.apiSecret && creds.accessToken && creds.accessTokenSecret) ||
    creds.oauth2AccessToken
  );

  console.log('====================================================');
  console.log('ChromaBot Scheduled Workflow Triggered');
  console.log(`Execution Time (UTC): ${new Date().toISOString()}`);
  console.log(`Context: ${context.name} (${context.id})`);
  console.log(`Engagement mode: ${(context.engagementMode || 'reply').toUpperCase()}`);
  console.log(`Target Tweet ID: ${context.targetTweetId}`);
  console.log(`Slot: ${options.slot.toUpperCase()}`);
  console.log(`Mode requested: ${wantLive ? 'LIVE X API (Real Post)' : 'DRY RUN (Simulated)'}`);
  console.log(
    `Global switches: dry-run ${services.settings.isGlobalDryRun() ? 'ON' : 'off'}, ` +
      `pause ${services.settings.isGlobalPaused() ? 'ON' : 'off'}`,
  );
  console.log(`X credentials configured: ${hasAuth ? 'yes' : 'NO (posts will be simulated)'}`);

  if (wantLive && options.slot === 'auto' && !options.force) {
    if (!isWithinScheduleWindow(env, deps.now ?? new Date())) {
      console.error(
        `[PostDrop] Refusing live post: current time is outside the SCHEDULE_TIMES window (${WINDOW_MINUTES} min). Use --force to override.`,
      );
      return 1;
    }
  }

  let outcome;
  try {
    outcome = await deps.drops.executeDrop({
      contextId: context.id,
      slotType: options.slot === 'auto' ? undefined : options.slot,
      forceLive: wantLive,
      forceDryRun: !wantLive,
      source: 'cli',
    });
  } catch (err) {
    console.error(`[PostDrop] Drop refused: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  const { result, log } = outcome;
  console.log('----------------------------------------------------');
  console.log(`Tweet Text: "${log.tweetText}"`);
  console.log(`Result Status: ${log.status.toUpperCase()}`);
  if (log.status === 'success') {
    console.log(`LIVE TWEET DISPATCHED: ${log.tweetUrl ?? log.tweetId}`);
  } else if (log.status === 'simulated') {
    console.log('Note: result was SIMULATED (dry run, global dry-run, or no X credentials).');
  } else {
    console.error(`Posting error: ${log.errorMessage}`);
  }

  writeSummary(
    [
      '',
      '### ChromaBot Workflow Drop Summary',
      '',
      '| Attribute | Details |',
      '| :--- | :--- |',
      `| **Context** | ${context.name} (${(context.engagementMode || 'reply').toUpperCase()}) |`,
      `| **Status** | ${log.status} |`,
      `| **Target** | [#${context.targetTweetId}](https://x.com/i/status/${context.targetTweetId}) |`,
      `| **Generated Tweet** | \`${log.tweetText}\` |`,
      log.tweetUrl ? `| **Tweet URL** | ${log.tweetUrl} |` : '',
      log.errorMessage ? `| **Error Detail** | \`${log.errorMessage}\` |` : '',
      '',
    ].join('\n'),
    env,
  );

  return !result.success || (wantLive && result.simulated) ? 1 : 0;
}
