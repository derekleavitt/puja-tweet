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
  };
  return summary;
};
