/**
 * Scheduler service for X ChromaBot
 * Multi-Context Autonomous Engine:
 *  - Checks every enabled Tweet Context on each tick.
 *  - Evaluates individual schedules (Interval or Fixed Clock Times).
 *  - Applies humanized anti-bot jitter per context.
 *  - Hands each due drop to dropService.executeDrop (no posting logic lives here).
 */

import {
  formatHHmm12h,
  matchFixedTime,
  normalizeHHmm,
  resolveTimezone,
  slotTypeForHour,
  zonedParts,
} from '../shared/time.js';
import { staleInFlightMs } from './services/contextService.js';
import { dropService } from './services/dropService.js';
import { services } from './services/index.js';
import type { PendingFire, TweetContext } from '../shared/types.js';

/** Minimum spacing between two live drops of the same X account. */
// Slightly under a minute: Cloud Scheduler ticks every ~60 s and a post takes a few seconds,
// so a strict 60 s gate made 1-minute campaigns skip every other tick.
const MIN_LIVE_SPACING_MS = 50 * 1000;
/**
 * A campaign this close to due counts as due, so tick timing drift (and jitter finer than the tick)
 * doesn't push it a whole tick later. Half a tick: 30 s for the external once-a-minute tick
 * (Cloud Scheduler), 5 s for the in-process 10 s loop. Override: SCHEDULER_DUE_TOLERANCE_MS.
 * Per campaign it is capped at a quarter of the wait (`campaignTolerance`), so two posts of one
 * campaign are never less than 3/4 of its interval apart.
 */
const dueToleranceMs = (): number => {
  const n = Number(process.env.SCHEDULER_DUE_TOLERANCE_MS);
  if (process.env.SCHEDULER_DUE_TOLERANCE_MS && Number.isFinite(n) && n >= 0) return n;
  return process.env.SCHEDULER_MODE?.trim().toLowerCase() === 'external' ? 30_000 : 5_000;
};

const campaignTolerance = (waitMs: number): number => Math.min(dueToleranceMs(), waitMs / 4);

/** A persisted pending fire (or a fixed-slot retry) older than this is dropped rather than fired late. */
const STALE_PENDING_MS = 60 * 60 * 1000;

/**
 * A fixed time missed by a late, skipped or busy tick (or a short outage) still fires within this
 * window, once; only the most recent missed slot fires (no burst), and never one from before the
 * campaign was created/resumed.
 */
const FIXED_CATCH_UP_MS = 10 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/** When a campaign's own clock says it is (or was) due; fixed-time campaigns use their armed fire. */
const dueAt = (c: TweetContext): number => {
  if (c.schedule.mode === 'interval') {
    if (c.retry) return c.retry.at;
    const intervalMs = (c.schedule.intervalMinutes || 60) * 60 * 1000;
    return (c.lastPostedTimestamp || 0) + intervalMs + (c.currentJitterMs || 0);
  }
  return c.pendingFire?.fireAt ?? (c.retry?.slotKey ? c.retry.at : Number.MAX_SAFE_INTEGER);
};

/** The most recent fixed time reached in the catch-up window that has not been handled yet. */
const dueFixedSlot = (c: TweetContext, now: number) => {
  const { scheduleTimes, timezone } = c.schedule;
  // When the schedule (re)started, not the last attempt: a failed or retried slot must not hide a
  // later one (legacy campaigns without the field fall back to the last attempt).
  const started = c.scheduleStartedAt ?? c.lastPostedTimestamp ?? 0;
  const startedMinute = Math.floor(started / MINUTE_MS) * MINUTE_MS;
  for (let back = 0; back <= FIXED_CATCH_UP_MS; back += MINUTE_MS) {
    const at = now - back;
    const match = matchFixedTime(scheduleTimes, new Date(at), timezone);
    if (!match) continue;
    // The newest reached slot was handled already: older ones in the window are, too.
    if (match.slotKey === c.lastPostedSlot) return null;
    // Never catch up a slot from before the campaign was created, resumed or rescheduled.
    if (back > 0 && Math.floor(at / MINUTE_MS) * MINUTE_MS < startedMinute) return null;
    return match;
  }
  return null;
};

const formatWait = (ms: number): string => {
  const sec = Math.max(0, Math.ceil(ms / 1000));
  return sec >= 60 ? `${Math.ceil(sec / 60)}m` : `${sec}s`;
};

/** The X account that will sign this campaign's next post (a conversation's next speaker). */
const postingAccountId = (c: TweetContext): string | undefined =>
  c.mode === 'conversation' ? c.conversationState?.nextSpeakerAccountId : c.accountId;

export interface TickOptions {
  /** Max drops this tick may start; the rest stay due and fire on the next tick. Default: no cap. */
  maxDrops?: number;
}

export interface TickResult {
  /** True when another tick was already in flight (nothing ran). */
  busy: boolean;
  fired: number;
  /** Enabled contexts that did not start a drop this tick. */
  skipped: number;
}

class SchedulerService {
  private dropsLeft = Infinity;
  /** `now` of the campaign being evaluated (the tick time its drop is anchored to). */
  private evalNow: number | undefined;
  private firedCount = 0;
  private enabledCount = 0;
  private timer: NodeJS.Timeout | null = null;
  private isProcessing = false;
  private tickGeneration = 0;

  public start() {
    if (this.timer) {
      clearInterval(this.timer);
    }
    // Check every 10 seconds for high precision across all context schedules
    this.timer = setInterval(() => void this.tick(), 10 * 1000);
    console.log('[Scheduler] Started multi-context chromatic post scheduler engine.');
  }

  public stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.log('[Scheduler] Stopped.');
  }

  /** Per-tick deadline (env SCHEDULER_TICK_TIMEOUT_MS, default 120 000). */
  private tickTimeoutMs() {
    const n = Number(process.env.SCHEDULER_TICK_TIMEOUT_MS);
    return Number.isFinite(n) && n > 0 ? n : 120_000;
  }

  /**
   * Anti-burst + cooldown gate, evaluated right before every drop. The X-account gates (cooldown,
   * live spacing) only apply to drops that will really reach X: a simulated campaign is never
   * delayed by another campaign's live post.
   */
  private canFireNow(context: TweetContext): boolean {
    if (this.dropsLeft <= 0) return false; // MAX_DROPS_PER_TICK: stays due for the next tick
    if (services.settings.isGlobalDryRun() || context.dryRun) return true;
    // Cooldown and spacing belong to the X account the campaign posts as.
    const accountId = postingAccountId(context);
    if (services.rateLimit.getCooldownState(accountId).isThrottled) return false;
    if (services.rateLimit.getWindowExhaustedSeconds(accountId) > 0) return false;
    return services.rateLimit.getTimeSinceLastLivePostMs(accountId) >= MIN_LIVE_SPACING_MS;
  }

  /** Starts a drop, charging it to the per-tick budget (callers check `canFireNow` first). */
  private async runDrop(args: Parameters<typeof dropService.executeDrop>[0]) {
    this.dropsLeft--;
    this.firedCount++;
    // Anchored to the tick, not to when an earlier drop of the same tick finished.
    await dropService.executeDrop({ ...args, scheduledAt: this.evalNow });
  }

  /**
   * Main scheduler loop: runs every 10 seconds and checks each enabled context.
   * A watchdog deadline guarantees `isProcessing` is released even if a post hangs.
   */
  public async tick(options: TickOptions = {}): Promise<TickResult> {
    if (this.isProcessing) return { busy: true, fired: 0, skipped: 0 };
    this.isProcessing = true;
    this.dropsLeft = options.maxDrops ?? Infinity;
    this.firedCount = 0;
    this.enabledCount = 0;
    const generation = ++this.tickGeneration;
    const timeoutMs = this.tickTimeoutMs();
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), timeoutMs);
    });
    try {
      const outcome = await Promise.race([this.runTick(generation), deadline]);
      if (outcome === 'timeout') {
        console.error(`[Scheduler] Tick exceeded ${timeoutMs} ms; releasing the scheduler lock.`);
      }
    } catch (err) {
      console.error('[Scheduler] Error during schedule tick loop:', err);
    } finally {
      clearTimeout(timer);
      // Invalidate a timed-out body so it stops firing further contexts.
      this.tickGeneration++;
      this.isProcessing = false;
    }
    return {
      busy: false,
      fired: this.firedCount,
      skipped: Math.max(0, this.enabledCount - this.firedCount),
    };
  }

  private async runTick(generation: number): Promise<'done'> {
    // Reads are side-effect free (REL-3), so the tick keeps every queue topped up.
    try {
      services.queue.ensureQueue();
    } catch (err) {
      console.error('[Scheduler] Failed to top up the queue:', err);
    }

    // Global gate: global pause (cooldowns and rate windows are per account).
    const globalBlock = this.getGlobalBlockedReason();
    if (globalBlock) {
      console.log(`[Scheduler] Tick skipped: ${globalBlock}`);
      return 'done';
    }

    const now = Date.now();
    // Longest-waiting campaign first, so a per-tick cap or the global live-post spacing never
    // starves a campaign just because another one comes earlier in the list.
    const contexts = services.contexts
      .getContexts()
      .filter((c) => c.enabled)
      .map((c) => ({ c, due: dueAt(c) }))
      .sort((a, b) => a.due - b.due)
      .map((x) => x.c);
    this.enabledCount = contexts.length;
    if (contexts.length === 0) {
      console.log('[Scheduler] Tick skipped: no running campaigns (all paused).');
      return 'done';
    }

    for (const context of contexts) {
      if (generation !== this.tickGeneration) break; // superseded by the watchdog
      try {
        await this.evaluateContextSchedule(context, now);
      } catch (ctxErr) {
        console.error(`[Scheduler] Error evaluating context "${context.name}":`, ctxErr);
      }
    }
    return 'done';
  }

  private async evaluateContextSchedule(context: TweetContext, now: number) {
    const { schedule } = context;
    this.evalNow = now;

    // A post of this campaign was sent to X and its result is not recorded: wait while it may still
    // be running, otherwise clear the marker (logged as interrupted) and continue normally.
    if (services.contexts.checkInFlight(context.id, dropService.isRunning(context.id), now)) return;

    // MODE 1: INTERVAL-BASED
    if (schedule.mode === 'interval') {
      const intervalMinutes = schedule.intervalMinutes || 60;
      const intervalMs = intervalMinutes * 60 * 1000;
      const lastPosted = context.lastPostedTimestamp || 0;
      const jitterMs = context.currentJitterMs || 0;
      const effectiveRequiredMs = intervalMs + jitterMs;

      if (!lastPosted && !context.retry) {
        // Legacy/unset clock: start the interval now instead of firing immediately.
        services.contexts.setContextLastPostedTimestamp(context.id, now);
        return;
      }
      // After a failure the retry time replaces the interval (back-off); otherwise one interval
      // after the last attempt. Either way at most ONE post fires, however long the downtime was.
      const tolerance = campaignTolerance(context.retry ? MINUTE_MS : intervalMs);
      // Hard floor: never two attempts closer than the interval (a retry: a minute) - tolerance.
      const minGapMs = (context.retry ? Math.min(MINUTE_MS, intervalMs) : intervalMs) - tolerance;
      const due =
        now - lastPosted >= minGapMs &&
        (context.retry
          ? now >= context.retry.at - tolerance
          : now - lastPosted >= effectiveRequiredMs - tolerance);
      if (due) {
        if (!this.canFireNow(context)) return; // anti-burst: wait for the next tick
        console.log(
          context.retry
            ? `[Scheduler] Context "${context.name}" retrying (${context.retry.reason}). Firing drop...`
            : `[Scheduler] Context "${context.name}" interval reached ` +
                `(${intervalMinutes}m base + ${Math.round(jitterMs / 1000)}s jitter). Firing drop...`,
        );
        await this.runDrop({ contextId: context.id, source: 'scheduler' });
      }
      return;
    }

    // MODE 2: FIXED TIMES (e.g. ["06:00", "18:00"])
    // A slot is armed when its HH:mm (normalised, in the context timezone) is reached, then fires
    // after the context's jitter delay. The armed fire is stored on the context (`pendingFire`) so a restart inside the jitter window still fires it once.
    const pending = context.pendingFire;
    if (pending) {
      if (now < pending.fireAt) return;
      // Already posted (or missed by more than an hour of downtime): discard instead of firing late.
      if (context.lastPostedSlot === pending.slotKey || now - pending.fireAt > STALE_PENDING_MS) {
        this.setPending(context, undefined);
        return;
      }
      if (!this.canFireNow(context)) return;
      this.setPending(context, undefined);
      await this.fireFixedSlot(context, pending.slotKey, pending.slotType, pending.matchedTime);
      return;
    }

    // A fixed slot whose post failed transiently is retried (back-off) for up to an hour.
    // A newer reached slot always wins over retrying an older one (newest missed slot fires).
    const retry = context.retry;
    if (retry?.slotKey) {
      const newer = dueFixedSlot(context, now);
      // Too old, superseded by a newer slot, or a newer slot fired since: the retry is obsolete.
      if (
        now - (retry.since ?? retry.at) > STALE_PENDING_MS ||
        retry.slotKey !== context.lastPostedSlot ||
        (newer && newer.slotKey !== retry.slotKey)
      ) {
        services.contexts.clearRetry(context.id);
        context.retry = undefined;
      } else {
        if (now < retry.at - campaignTolerance(MINUTE_MS) || !this.canFireNow(context)) return;
        const matchedTime = retry.slotKey.slice(-5);
        const slotType = slotTypeForHour(Number(matchedTime.slice(0, 2)));
        await this.fireFixedSlot(context, retry.slotKey, slotType, matchedTime);
        return;
      }
    }

    const match = dueFixedSlot(context, now);
    if (!match) return;

    const slotType = slotTypeForHour(match.parts.hour);
    const jitterMs = schedule.humanizeJitterEnabled ? context.currentJitterMs || 0 : 0;
    if (jitterMs > 0 || !this.canFireNow(context)) {
      this.setPending(context, {
        slotKey: match.slotKey,
        slotType,
        matchedTime: match.matchedTime,
        fireAt: now + jitterMs,
      });
      console.log(
        `[Scheduler] Context "${context.name}" fixed time ${match.matchedTime} (${resolveTimezone(schedule.timezone)}) reached; ` +
          `delaying (${Math.round(jitterMs / 1000)}s jitter, anti-burst gate).`,
      );
      return;
    }
    await this.fireFixedSlot(context, match.slotKey, slotType, match.matchedTime);
  }

  private setPending(context: TweetContext, pending: PendingFire | undefined) {
    context.pendingFire = pending;
    services.contexts.setContextPendingFire(context.id, pending);
  }

  private async fireFixedSlot(
    context: TweetContext,
    slotKey: string,
    slotType: 'morning' | 'evening',
    matchedTime: string,
  ) {
    // Record before posting so a slow/failed post can never double-fire the same slot.
    context.lastPostedSlot = slotKey;
    services.contexts.setContextLastPostedSlot(context.id, slotKey);
    console.log(
      `[Scheduler] Context "${context.name}" fixed time reached (${matchedTime}). Firing drop...`,
    );
    await this.runDrop({ contextId: context.id, slotType, source: 'scheduler', slotKey });
  }

  /** Why no scheduled post can go out at all right now; undefined when the scheduler is free to post. */
  public getGlobalBlockedReason(): string | undefined {
    if (services.settings.isGlobalPaused()) {
      return 'Paused: scheduled posts are off (switch the header to Running)';
    }
    return undefined;
  }

  /** Why this campaign won't be posted by the scheduler right now, if anything blocks it. */
  public getBlockedReason(context: TweetContext): string | undefined {
    const global = this.getGlobalBlockedReason();
    if (global) return global;
    if (!context.enabled) {
      return context.autoPausedReason
        ? `Campaign auto-paused: ${context.autoPausedReason}`
        : 'Campaign is paused (resume it on its card)';
    }
    const accountId = postingAccountId(context);
    const handle = services.accounts.handleOf(accountId);
    // A conversation waits for its next speaker (it never skips to another voice).
    const who =
      context.mode === 'conversation'
        ? `Next speaker ${handle ? `@${handle}` : (accountId ?? '?')}: `
        : '';
    const problem = services.accounts.problem(accountId);
    if (problem) return `${who}${problem}`;
    const windowSeconds = services.rateLimit.getWindowExhaustedSeconds(accountId);
    if (windowSeconds > 0) {
      return `${who}X rate-limit window used up${handle ? ` for @${handle}` : ''}: resets in ${Math.ceil(windowSeconds / 60)}m`;
    }
    const cooldown = services.rateLimit.getCooldownState(accountId);
    if (cooldown.isThrottled) {
      return `${who}X cooldown${handle ? ` for @${handle}` : ''}: ${Math.ceil(cooldown.secondsRemaining / 60)}m left${cooldown.reason ? ` (${cooldown.reason})` : ''}`;
    }
    const now = Date.now();
    const marker = context.inFlight;
    if (marker?.sentAt && now - marker.sentAt < staleInFlightMs()) return `${who}Posting now…`;
    const retry = context.retry;
    if (retry && retry.at > now) {
      const attempts = retry.transient && retry.attempt > 1 ? `, attempt ${retry.attempt + 1}` : '';
      return `${who}Retrying in ${formatWait(retry.at - now)} (${retry.reason}${attempts})`;
    }
    return undefined;
  }

  /** Next post of one campaign (the active one by default); undefined for an unknown id. */
  public getNextScheduledPost(contextId?: string) {
    const context = contextId
      ? services.contexts.getContext(contextId)
      : services.contexts.getActiveContext();
    return context ? this.calculateNextPostForContext(context) : undefined;
  }

  public getAllNextScheduledPosts() {
    return services.contexts.getContexts().map((c) => ({
      ...this.calculateNextPostForContext(c),
      enabled: c.enabled,
      targetTweetId: c.targetTweetId,
    }));
  }

  private calculateNextPostForContext(context: TweetContext) {
    const speakerHandle =
      context.mode === 'conversation'
        ? services.accounts.handleOf(context.conversationState?.nextSpeakerAccountId)
        : undefined;
    return {
      ...this.calculateNextPostTiming(context),
      blockedReason: this.getBlockedReason(context),
      ...(speakerHandle ? { speakerHandle } : {}),
    };
  }

  private calculateNextPostTiming(context: TweetContext) {
    const { schedule } = context;
    const now = Date.now();

    // If Interval Mode
    if (schedule.mode === 'interval') {
      const intervalMinutes = schedule.intervalMinutes || 60;
      const intervalSeconds = intervalMinutes * 60;
      const lastPosted = context.lastPostedTimestamp || 0;
      const jitterMs = context.currentJitterMs || 0;
      const jitterSeconds = Math.round(jitterMs / 1000);
      const totalCycleSeconds = intervalSeconds + jitterSeconds;

      let secondsUntil = totalCycleSeconds;
      if (context.retry) {
        secondsUntil = Math.max(0, Math.ceil((context.retry.at - now) / 1000));
      } else if (lastPosted > 0) {
        const elapsedSeconds = Math.floor((now - lastPosted) / 1000);
        secondsUntil = Math.max(0, totalCycleSeconds - elapsedSeconds);
      }

      const hours = Math.floor(secondsUntil / 3600);
      const minutes = Math.floor((secondsUntil % 3600) / 60);
      const seconds = secondsUntil % 60;

      const formatIntervalLabel = (mins: number) => {
        if (mins < 60) return `Every ${mins}m`;
        const hrs = mins / 60;
        return `Every ${hrs}h`;
      };

      const jitterFormatted =
        jitterSeconds > 0
          ? `+${jitterSeconds >= 60 ? `${Math.floor(jitterSeconds / 60)}m ${jitterSeconds % 60}s` : `${jitterSeconds}s`} jitter`
          : undefined;

      return {
        contextId: context.id,
        contextName: context.name,
        slotTime: `Every ${intervalMinutes}m`,
        label: formatIntervalLabel(intervalMinutes),
        isMorning: false,
        secondsUntil,
        countdownFormatted: `${hours}h ${minutes}m ${seconds}s`,
        targetTimezone: 'Repeating Interval',
        jitterSeconds,
        jitterFormatted,
      };
    }

    // Fixed Times Mode
    const timezone = resolveTimezone(schedule.timezone);
    const zoned = zonedParts(new Date(now), timezone);
    const curSecondsOfDay = zoned.hour * 3600 + zoned.minute * 60 + zoned.second;

    const parsedSlots = (schedule.scheduleTimes || ['06:00', '18:00'])
      .map((raw) => normalizeHHmm(raw))
      .filter((t): t is string => t !== null)
      .map((timeStr) => {
        const [h, m] = timeStr.split(':').map(Number);
        return {
          timeStr,
          secondsOfDay: h * 3600 + m * 60,
          isMorning: h < 12,
          label: `${formatHHmm12h(timeStr)} Drop`,
        };
      })
      .sort((a, b) => a.secondsOfDay - b.secondsOfDay);

    let nextSlot = parsedSlots.find((s) => s.secondsOfDay > curSecondsOfDay);
    let secondsUntil: number;

    if (nextSlot) {
      secondsUntil = nextSlot.secondsOfDay - curSecondsOfDay;
    } else if (parsedSlots.length > 0) {
      nextSlot = parsedSlots[0];
      secondsUntil = 86400 - curSecondsOfDay + nextSlot.secondsOfDay;
    } else {
      return {
        contextId: context.id,
        contextName: context.name,
        slotTime: 'No schedule',
        label: 'None',
        isMorning: false,
        secondsUntil: 0,
        countdownFormatted: '0h 0m 0s',
        targetTimezone: timezone,
      };
    }

    const hours = Math.floor(secondsUntil / 3600);
    const minutes = Math.floor((secondsUntil % 3600) / 60);
    const seconds = secondsUntil % 60;

    return {
      contextId: context.id,
      contextName: context.name,
      slotTime: nextSlot.timeStr,
      label: nextSlot.label,
      isMorning: nextSlot.isMorning,
      secondsUntil,
      countdownFormatted: `${hours}h ${minutes}m ${seconds}s`,
      targetTimezone: timezone,
    };
  }
}

export const scheduler = new SchedulerService();
