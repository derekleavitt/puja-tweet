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
import { dropService } from './services/dropService.js';
import { services } from './services/index.js';
import type { PendingFire, TweetContext } from '../shared/types.js';

/** Minimum spacing between any two live drops across all campaigns. */
// Slightly under a minute: Cloud Scheduler ticks every ~60 s and a post takes a few seconds,
// so a strict 60 s gate made 1-minute campaigns skip every other tick.
const MIN_LIVE_SPACING_MS = 50 * 1000;
/** A campaign this close to due counts as due, so tick timing drift doesn't push it a whole tick later. */
const DUE_TOLERANCE_MS = 5 * 1000;

/** A persisted pending fire older than this at boot/tick is dropped rather than fired late. */
const STALE_PENDING_MS = 60 * 60 * 1000;

/** When a campaign's own clock says it is (or was) due; fixed-time campaigns use their armed fire. */
const dueAt = (c: TweetContext): number => {
  if (c.schedule.mode === 'interval') {
    const intervalMs = (c.schedule.intervalMinutes || 60) * 60 * 1000;
    return (c.lastPostedTimestamp || 0) + intervalMs + (c.currentJitterMs || 0);
  }
  return c.pendingFire?.fireAt ?? Number.MAX_SAFE_INTEGER;
};

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
    if (services.rateLimit.getCooldownState().isThrottled) return false;
    return services.rateLimit.getTimeSinceLastLivePostMs() >= MIN_LIVE_SPACING_MS;
  }

  /** Starts a drop, charging it to the per-tick budget (callers check `canFireNow` first). */
  private async runDrop(args: Parameters<typeof dropService.executeDrop>[0]) {
    this.dropsLeft--;
    this.firedCount++;
    await dropService.executeDrop(args);
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

    // Global gates: global pause, cooldown, exhausted X rate window.
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

    // MODE 1: INTERVAL-BASED
    if (schedule.mode === 'interval') {
      const intervalMinutes = schedule.intervalMinutes || 60;
      const intervalMs = intervalMinutes * 60 * 1000;
      const lastPosted = context.lastPostedTimestamp || 0;
      const jitterMs = context.currentJitterMs || 0;
      const effectiveRequiredMs = intervalMs + jitterMs;

      if (!lastPosted) {
        // Legacy/unset clock: start the interval now instead of firing immediately.
        services.contexts.setContextLastPostedTimestamp(context.id, now);
        return;
      }
      if (now - lastPosted >= effectiveRequiredMs - DUE_TOLERANCE_MS) {
        if (!this.canFireNow(context)) return; // anti-burst: wait for the next tick
        console.log(
          `[Scheduler] Context "${context.name}" interval reached ` +
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

    const match = matchFixedTime(schedule.scheduleTimes, new Date(now), schedule.timezone);
    if (!match || context.lastPostedSlot === match.slotKey) return;

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
    services.contexts.setContextLastPostedSlot(context.id, slotKey);
    console.log(
      `[Scheduler] Context "${context.name}" fixed time reached (${matchedTime}). Firing drop...`,
    );
    await this.runDrop({ contextId: context.id, slotType, source: 'scheduler' });
  }

  /** Why no scheduled post can go out at all right now; undefined when the scheduler is free to post. */
  public getGlobalBlockedReason(): string | undefined {
    if (services.settings.isGlobalPaused()) {
      return 'Paused: scheduled posts are off (switch the header to Running)';
    }
    const cooldown = services.rateLimit.getCooldownState();
    if (cooldown.isThrottled) {
      return `X cooldown: ${Math.ceil(cooldown.secondsRemaining / 60)}m left${cooldown.reason ? ` (${cooldown.reason})` : ''}`;
    }
    const telemetry = services.rateLimit.getRateLimitTelemetry();
    if (telemetry.headersCaptured && telemetry.remaining <= 0 && telemetry.secondsUntilReset > 0) {
      return `X rate-limit window used up: resets in ${Math.ceil(telemetry.secondsUntilReset / 60)}m`;
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
    return {
      ...this.calculateNextPostTiming(context),
      blockedReason: this.getBlockedReason(context),
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
      if (lastPosted > 0) {
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
