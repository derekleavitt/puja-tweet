/**
 * The parts of a content-wipe job shared outside `wipeService`: its public summary (shown under
 * each X account) and which X endpoint / counter each kind of item uses.
 */

import type { WipeJobSummary } from '../../shared/types.js';
import type { WipeEndpoint, WipeItem, WipeJob } from '../store/Store.js';

export const ENDPOINT: Record<WipeItem['kind'], WipeEndpoint> = {
  post: 'deletePost',
  retweet: 'unretweet',
  like: 'unlike',
};
export const COUNT: Record<WipeItem['kind'], keyof WipeJob['counts']> = {
  post: 'posts',
  retweet: 'retweets',
  like: 'likes',
};

/** X allows about this many calls per window on each removal endpoint (about 50 per 15 minutes). */
export const CALLS_PER_WINDOW = 50;
export const WINDOW_MINUTES = 15;

/**
 * Rough minutes until the queued items are removed: each kind has its own window, so the slowest
 * kind decides, plus any wait already running. More may still be listed (`moreToRead`).
 */
export const estimateMinutesLeft = (job: WipeJob, now = Date.now()): number => {
  const byEndpoint = new Map<WipeEndpoint, number>();
  for (const item of job.queue) {
    const ep = ENDPOINT[item.kind];
    byEndpoint.set(ep, (byEndpoint.get(ep) ?? 0) + 1);
  }
  let worst = 0;
  for (const [ep, n] of byEndpoint) {
    const waitMin = Math.max(0, ((job.waitUntil[ep] ?? 0) - now) / 60_000);
    // A window's worth goes right away (or as soon as the current wait ends); every further batch
    // waits a full window.
    const windows = Math.ceil(n / CALLS_PER_WINDOW) - 1;
    worst = Math.max(worst, waitMin + windows * WINDOW_MINUTES);
  }
  return Math.ceil(worst);
};

/** The public view of a job (no queue, no cursor). */
export const summarizeWipeJob = (job: WipeJob | undefined, now = Date.now()) => {
  if (!job) return undefined;
  const waits = Object.values(job.waitUntil).filter((t): t is number => !!t && t > now);
  const summary: WipeJobSummary = {
    status: job.status,
    simulate: job.simulate,
    phase: job.phase,
    pass: job.pass,
    counts: { ...job.counts },
    queued: job.queue.length,
    startedAt: job.startedAt,
    ...(job.finishedAt ? { finishedAt: job.finishedAt } : {}),
    ...(job.status === 'running' && waits.length
      ? { waitingUntil: new Date(Math.min(...waits)).toISOString() }
      : {}),
    ...(job.lastError ? { lastError: job.lastError } : {}),
    ...(job.status === 'running'
      ? {
          estimatedMinutesLeft: estimateMinutesLeft(job, now),
          moreToRead: !job.listDone || job.phase === 'posts',
        }
      : {}),
  };
  return summary;
};
