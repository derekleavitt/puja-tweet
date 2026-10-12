/**
 * "Delete all content" of one X account (Settings → X accounts): its posts, replies and quotes are
 * deleted, its retweets undone and its likes removed. X allows about 50 of each per 15 minutes
 * (unlikes also 1,000 a day) and lists only the newest ~3,200 posts, so this is a background job:
 * every scheduler tick advances it a little, waits out rate limits from X's headers, and repeats a
 * pass over the timeline until a pass removes nothing. With the global dry run on it only counts.
 */

import { HttpError } from '../middleware/error.js';
import type { WipeEndpoint, WipeItem, WipeJob } from '../store/Store.js';
import { COUNT, ENDPOINT } from './wipeJob.js';
import { xContentClient, type XCallResult, type XContentClient } from '../xContentClient.js';
import type { AccountService } from './accountService.js';
import type { SettingsService } from './settingsService.js';
import type { StateManager } from './stateManager.js';
import type { TwitterCredentials } from '../twitterClient.js';

export const WIPE_MAX_CALLS_PER_TICK = 12;
export const WIPE_TICK_BUDGET_MS = 15_000;
const RETRY_LATER_MS = 60_000;
const DEFAULT_WINDOW_MS = 15 * 60_000;
/** Posts that could not be removed (kept so later passes skip them instead of failing again). */
const MAX_FAILED_IDS = 2_000;

type Deps = {
  sm: StateManager;
  accounts: Pick<
    AccountService,
    'get' | 'getCredentialsForAccount' | 'markRevoked' | 'pauseCampaignsForWipe'
  >;
  settings: Pick<SettingsService, 'isGlobalDryRun'>;
  client?: XContentClient;
  now?: () => number;
};

export class WipeService {
  private readonly client: XContentClient;
  private readonly now: () => number;
  private running = false;

  constructor(private readonly deps: Deps) {
    this.client = deps.client ?? xContentClient;
    this.now = deps.now ?? (() => Date.now());
  }

  private get jobs(): Record<string, WipeJob> {
    return (this.deps.sm.state.wipeJobs ??= {});
  }

  get(accountId: string): WipeJob | undefined {
    return this.jobs[accountId];
  }

  /** Starts a job; `confirm` must be the account's @handle. Pauses campaigns using the account. */
  start(accountId: string, confirm: unknown): { job: WipeJob; pausedCampaigns: string[] } {
    const account = this.deps.accounts.get(accountId);
    if (!account) throw new HttpError(404, `Account ${accountId} not found`);
    if (this.jobs[account.id]?.status === 'running') {
      throw new HttpError(409, `A content wipe of @${account.handle} is already running.`);
    }
    if (!account.handle || !account.userId) {
      throw new HttpError(400, 'Verify this account first (its @handle and user id are unknown).');
    }
    const typed = typeof confirm === 'string' ? confirm.trim().replace(/^@/, '') : '';
    if (typed.toLowerCase() !== account.handle.toLowerCase()) {
      throw new HttpError(400, `Type @${account.handle} to confirm.`);
    }
    const creds = this.deps.accounts.getCredentialsForAccount(account.id);
    if (!creds?.apiKey || !creds.accessToken || !creds.accessTokenSecret) {
      throw new HttpError(400, `@${account.handle} has no usable X tokens: reconnect it first.`);
    }
    const simulate = this.deps.settings.isGlobalDryRun();
    const job: WipeJob = {
      accountId: account.id,
      handle: account.handle,
      userId: account.userId,
      status: 'running',
      simulate,
      phase: 'posts',
      pass: 1,
      counts: { posts: 0, retweets: 0, likes: 0, failed: 0 },
      startedAt: new Date(this.now()).toISOString(),
      listDone: false,
      queue: [],
      passRemoved: 0,
      waitUntil: {},
      failedIds: [],
    };
    const pausedCampaigns = simulate ? [] : this.deps.accounts.pauseCampaignsForWipe(account.id);
    this.jobs[account.id] = job;
    this.deps.sm.persist();
    console.log(
      `[Wipe] ${simulate ? 'Counting (global dry run)' : 'Deleting'} all content of @${job.handle}.`,
    );
    return { job, pausedCampaigns };
  }

  cancel(accountId: string): WipeJob {
    const job = this.jobs[accountId];
    if (!job) throw new HttpError(404, 'No content wipe for this account.');
    if (job.status === 'running') {
      this.finish(job, 'cancelled');
      this.deps.sm.persist();
    }
    return job;
  }

  /** One tick's worth of work for every running job. Never throws. */
  async advance(budgetMs = WIPE_TICK_BUDGET_MS, maxCalls = WIPE_MAX_CALLS_PER_TICK) {
    if (this.running) return;
    this.running = true;
    try {
      for (const job of Object.values(this.jobs)) {
        if (job.status !== 'running') continue;
        try {
          await this.step(job, this.now() + budgetMs, maxCalls);
        } catch (err) {
          job.lastError = err instanceof Error ? err.message : String(err);
          console.error(`[Wipe] @${job.handle}:`, job.lastError);
        }
        this.deps.sm.persist();
      }
    } finally {
      this.running = false;
    }
  }

  private finish(job: WipeJob, status: WipeJob['status'], error?: string) {
    job.status = status;
    job.finishedAt = new Date(this.now()).toISOString();
    job.queue = [];
    if (error) job.lastError = error;
    const { posts, retweets, likes, failed } = job.counts;
    // The reason is part of the line: a job that stops must explain itself in the server log.
    const why = status === 'failed' || error ? ` Reason: ${job.lastError}` : '';
    console.log(
      `[Wipe] @${job.handle} ${status}: ${posts} posts, ${retweets} retweets, ${likes} likes` +
        `${job.simulate ? ' (counted only)' : ''}, ${failed} failed.${why}`,
    );
  }

  private available(job: WipeJob, endpoint: WipeEndpoint) {
    return !(job.waitUntil[endpoint] && job.waitUntil[endpoint]! > this.now());
  }

  private async step(job: WipeJob, deadline: number, maxCalls: number) {
    const creds = this.deps.accounts.getCredentialsForAccount(job.accountId);
    if (!creds)
      return this.finish(job, 'failed', 'The account is gone or its tokens are unusable.');
    for (let calls = 0; calls < maxCalls && this.now() < deadline;) {
      if (job.status !== 'running') return;
      const index = job.queue.findIndex((item) => this.available(job, ENDPOINT[item.kind]));
      if (index >= 0) {
        calls++;
        await this.remove(job, creds, index);
        continue;
      }
      if (job.queue.length) return; // every queued kind is waiting for its rate window
      if (!job.listDone) {
        if (!this.available(job, job.phase === 'posts' ? 'timeline' : 'likedList')) return;
        calls++;
        await this.list(job, creds);
        continue;
      }
      // The list is exhausted: another pass (older posts surface as newer ones go), or move on.
      if (!job.simulate && job.passRemoved > 0) {
        Object.assign(job, {
          pass: job.pass + 1,
          passRemoved: 0,
          cursor: undefined,
          listDone: false,
        });
      } else if (job.phase === 'posts') {
        Object.assign(job, {
          phase: 'likes',
          pass: 1,
          passRemoved: 0,
          cursor: undefined,
          listDone: false,
        });
      } else {
        return this.finish(job, 'done');
      }
    }
  }

  /** Records X's rate window; true when the call was rate limited (429). */
  private rate(job: WipeJob, endpoint: WipeEndpoint, r: XCallResult): boolean {
    const limited = r.status === 429;
    const until = limited
      ? (r.resetAt ?? this.now() + DEFAULT_WINDOW_MS)
      : r.remaining === 0
        ? r.resetAt
        : undefined;
    if (until) {
      job.waitUntil[endpoint] = until;
      console.log(
        `[Wipe] @${job.handle}: X rate limit for ${endpoint}, waiting until ${new Date(until).toISOString()}.`,
      );
    }
    return limited;
  }

  /** 401: the account's tokens were revoked; the job cannot continue. */
  private revoked(job: WipeJob) {
    this.deps.accounts.markRevoked(job.accountId, 'X rejected the tokens during a content wipe.');
    this.finish(job, 'failed', `X rejected @${job.handle}'s tokens: reconnect it and start again.`);
  }

  private async list(job: WipeJob, creds: TwitterCredentials) {
    const endpoint: WipeEndpoint = job.phase === 'posts' ? 'timeline' : 'likedList';
    let r: XCallResult;
    let items: WipeItem[];
    let nextToken: string | undefined;
    try {
      if (job.phase === 'posts') {
        const got = await this.client.listPosts(creds, job.userId, job.cursor);
        r = got.result;
        items = got.page.items.map((p) =>
          p.retweetOf ? { kind: 'retweet', id: p.retweetOf } : { kind: 'post', id: p.id },
        );
        nextToken = got.page.nextToken;
      } else {
        const got = await this.client.listLikes(creds, job.userId, job.cursor);
        r = got.result;
        items = got.page.items.map((id) => ({ kind: 'like', id }));
        nextToken = got.page.nextToken;
      }
    } catch (err) {
      job.waitUntil[endpoint] = this.now() + RETRY_LATER_MS;
      job.lastError = `Could not reach X: ${err instanceof Error ? err.message : String(err)}`;
      return;
    }
    if (this.rate(job, endpoint, r)) return;
    if (r.status === 401) return this.revoked(job);
    if (r.status === 402 || r.status === 403) {
      const what = job.phase === 'posts' ? 'posts' : 'likes';
      const message = `X refused to list @${job.handle}'s ${what} (HTTP ${r.status}): the X plan may not include reading them.`;
      if (job.phase === 'posts') return this.finish(job, 'failed', message);
      job.lastError = message; // keep what the posts phase did
      return this.finish(job, 'done');
    }
    if (r.status >= 400) {
      job.waitUntil[endpoint] = this.now() + RETRY_LATER_MS;
      job.lastError = `X answered HTTP ${r.status} listing ${job.phase}; retrying.`;
      return;
    }
    const failed = new Set(job.failedIds);
    const fresh = items.filter((i) => !failed.has(`${i.kind}:${i.id}`));
    if (job.simulate) for (const i of fresh) job.counts[COUNT[i.kind]]++;
    else job.queue.push(...fresh);
    job.cursor = nextToken;
    job.listDone = !nextToken;
  }

  private async remove(job: WipeJob, creds: TwitterCredentials, index: number) {
    const item = job.queue[index];
    const endpoint = ENDPOINT[item.kind];
    let r: XCallResult;
    try {
      r =
        item.kind === 'post'
          ? await this.client.deletePost(creds, item.id)
          : item.kind === 'retweet'
            ? await this.client.undoRetweet(creds, job.userId, item.id)
            : await this.client.removeLike(creds, job.userId, item.id);
    } catch (err) {
      job.waitUntil[endpoint] = this.now() + RETRY_LATER_MS;
      job.lastError = `Could not reach X: ${err instanceof Error ? err.message : String(err)}`;
      return;
    }
    if (this.rate(job, endpoint, r)) return;
    if (r.status === 401) return this.revoked(job);
    if (r.status >= 500) {
      job.waitUntil[endpoint] = this.now() + RETRY_LATER_MS;
      job.lastError = `X answered HTTP ${r.status}; retrying.`;
      return;
    }
    job.queue.splice(index, 1);
    if (r.status < 300) {
      job.counts[COUNT[item.kind]]++;
      job.passRemoved++;
    } else if (r.status !== 404) {
      // 404 = already gone. Anything else will not work on a retry either: skip it from now on.
      job.counts.failed++;
      job.failedIds = [...job.failedIds, `${item.kind}:${item.id}`].slice(-MAX_FAILED_IDS);
      job.lastError = `X refused to remove ${item.kind} ${item.id} (HTTP ${r.status}).`;
    }
  }
}
