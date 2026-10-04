/**
 * Scheduler service for X ChromaBot
 * Multi-Context Autonomous Engine:
 *  - Checks every enabled Tweet Context on each tick.
 *  - Evaluates individual schedules (Interval or Fixed Clock Times).
 *  - Applies humanized anti-bot jitter per context.
 *  - Hands each due drop to dropService.executeDrop (no posting logic lives here).
 */

import {
  matchFixedTime,
  normalizeHHmm,
  resolveTimezone,
  slotTypeForHour,
  zonedParts,
} from '../shared/time.js';
import { dropService } from './services/dropService.js';
import { services } from './services/index.js';
import type { TweetContext } from '../shared/types.js';

class SchedulerService {
  private timer: NodeJS.Timeout | null = null;
  private isProcessing = false;
  private pendingFires = new Map<
    string,
    { slotKey: string; slotType: 'morning' | 'evening'; matchedTime: string; fireAt: number }
  >();

  public start() {
    if (this.timer) {
      clearInterval(this.timer);
    }
    // Check every 10 seconds for high precision across all context schedules
    this.timer = setInterval(() => this.tick(), 10 * 1000);
    console.log('[Scheduler] Started multi-context chromatic post scheduler engine.');
  }

  public stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.log('[Scheduler] Stopped.');
  }

  /**
   * Main scheduler loop: runs every 10 seconds and checks each enabled context.
   */
  public async tick() {
    if (this.isProcessing) return;

    try {
      this.isProcessing = true;
      const contexts = services.contexts.getContexts().filter((c) => c.enabled);
      if (contexts.length === 0) return;

      // 1. Check Global Rate Limit / Cooldown
      const cooldown = services.rateLimit.getCooldownState();
      if (cooldown.isThrottled) {
        return; // Safe standby while cooldown expires
      }

      // 2. Pre-Emptive Rate Window Check: If remaining requests in window is 0, wait for reset
      const telemetry = services.rateLimit.getRateLimitTelemetry();
      if (
        telemetry.headersCaptured &&
        telemetry.remaining <= 0 &&
        telemetry.secondsUntilReset > 0
      ) {
        return; // Standby until 15-minute window resets
      }

      // 3. Anti-Burst Protection: Ensure minimum 60s spacing between any live drops across all campaigns
      if (services.rateLimit.getTimeSinceLastLivePostMs() < 60 * 1000) {
        return; // Stagger to next tick
      }

      const now = Date.now();

      for (const context of contexts) {
        try {
          await this.evaluateContextSchedule(context, now);
        } catch (ctxErr) {
          console.error(`[Scheduler] Error evaluating context "${context.name}":`, ctxErr);
        }
      }
    } catch (err) {
      console.error('[Scheduler] Error during schedule tick loop:', err);
    } finally {
      this.isProcessing = false;
    }
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

      if (!lastPosted || now - lastPosted >= effectiveRequiredMs) {
        console.log(
          `[Scheduler] Context "${context.name}" interval reached ` +
            `(${intervalMinutes}m base + ${Math.round(jitterMs / 1000)}s jitter). Firing drop...`,
        );
        await dropService.executeDrop({
          contextId: context.id,
          source: 'scheduler',
        });
      }
      return;
    }

    // MODE 2: FIXED TIMES (e.g. ["06:00", "18:00"])
    // A slot is armed when its HH:mm (normalised, in the context timezone) is reached, then fires
    // after the context's jitter delay. Pending fires are in-memory; only lastPostedSlot persists.
    const pending = this.pendingFires.get(context.id);
    if (pending) {
      if (now < pending.fireAt) return;
      this.pendingFires.delete(context.id);
      await this.fireFixedSlot(context, pending.slotKey, pending.slotType, pending.matchedTime);
      return;
    }

    const match = matchFixedTime(schedule.scheduleTimes, new Date(now), schedule.timezone);
    if (!match || context.lastPostedSlot === match.slotKey) return;

    const slotType = slotTypeForHour(match.parts.hour);
    const jitterMs = schedule.humanizeJitterEnabled ? context.currentJitterMs || 0 : 0;
    if (jitterMs > 0) {
      this.pendingFires.set(context.id, {
        slotKey: match.slotKey,
        slotType,
        matchedTime: match.matchedTime,
        fireAt: now + jitterMs,
      });
      console.log(
        `[Scheduler] Context "${context.name}" fixed time ${match.matchedTime} (${resolveTimezone(schedule.timezone)}) reached; ` +
          `delaying ${Math.round(jitterMs / 1000)}s for jitter.`,
      );
      return;
    }
    await this.fireFixedSlot(context, match.slotKey, slotType, match.matchedTime);
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
    await dropService.executeDrop({ contextId: context.id, slotType, source: 'scheduler' });
  }

  public getNextScheduledPost(contextId?: string) {
    const context = contextId
      ? services.contexts.getContext(contextId) || services.contexts.getActiveContext()
      : services.contexts.getActiveContext();
    return this.calculateNextPostForContext(context);
  }

  public getAllNextScheduledPosts() {
    return services.contexts.getContexts().map((c) => ({
      ...this.calculateNextPostForContext(c),
      enabled: c.enabled,
      targetTweetId: c.targetTweetId,
    }));
  }

  private calculateNextPostForContext(context: TweetContext) {
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
          label: h === 6 ? '6:00 AM Drop' : h === 18 ? '6:00 PM Drop' : `${timeStr} Drop`,
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
