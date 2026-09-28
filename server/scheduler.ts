/**
 * Scheduler service for X ChromaBot
 * Multi-Context Autonomous Engine:
 *  - Checks every enabled Tweet Context on each tick.
 *  - Evaluates individual schedules (Interval or Fixed Clock Times).
 *  - Applies humanized anti-bot jitter per context.
 *  - Dispatches targeted replies to each context's specific targetTweetId.
 */

import { formatTweetText, generateColor, ColorData } from './colorEngine.js';
import { storage, TweetContext } from './storage.js';
import { postColorTweet } from './twitterClient.js';

export interface ExecuteDropOptions {
  contextId?: string;
  slotType?: 'morning' | 'evening' | 'manual';
  forceLive?: boolean;
  source?: 'scheduler' | 'webhook' | 'manual';
}

class SchedulerService {
  private timer: NodeJS.Timeout | null = null;
  private isProcessing = false;

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
   * Execute drop for a specific context or the active context.
   */
  public async executeDrop(options: ExecuteDropOptions = {}) {
    const context: TweetContext = options.contextId
      ? (storage.getContext(options.contextId) || storage.getActiveContext())
      : storage.getActiveContext();

    const isMorning = options.slotType
      ? options.slotType === 'morning'
      : (new Date().getUTCHours() - 7 + 24) % 24 < 12;

    const slotType = options.slotType || (isMorning ? 'morning' : 'evening');
    const color: ColorData = storage.popNextQueueSlot(slotType === 'morning' ? 'morning' : 'evening');
    const timeTag = isMorning ? '6:00 AM' : '6:00 PM';
    const text = formatTweetText(context.template, color, timeTag);

    const isDryRun = options.forceLive ? false : (context.dryRun ?? false);
    const creds = storage.getEffectiveCredentials();

    console.log(
      `[Scheduler] Executing drop for context "${context.name}" (${context.id}) ` +
      `-> Target Tweet: #${context.targetTweetId} (source: ${options.source || 'manual'}, mode: ${isDryRun ? 'DRY-RUN' : 'LIVE X'})`
    );

    const tweetRes = await postColorTweet(
      creds,
      {
        text,
        replyToTweetId: context.targetTweetId,
      },
      isDryRun
    );

    const now = Date.now();
    const status = tweetRes.success ? (tweetRes.simulated ? ('simulated' as const) : ('success' as const)) : ('error' as const);

    // Record stats and roll jitter on this context
    storage.recordContextPostResult(context.id, status);

    const logEntry = {
      id: `log_${now}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date().toISOString(),
      slotType,
      targetTweetId: context.targetTweetId,
      color,
      tweetText: text,
      tweetId: tweetRes.tweetId,
      tweetUrl: tweetRes.url,
      status,
      errorMessage: tweetRes.error,
      contextId: context.id,
      contextName: context.name,
    };

    storage.addLog(logEntry);

    return {
      success: tweetRes.success,
      result: tweetRes,
      log: logEntry,
      context,
    };
  }

  /**
   * Main scheduler loop: runs every 10 seconds and checks each enabled context.
   */
  public async tick() {
    if (this.isProcessing) return;

    try {
      this.isProcessing = true;
      const contexts = storage.getContexts().filter(c => c.enabled);
      if (contexts.length === 0) return;

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

      if (!lastPosted || (now - lastPosted) >= effectiveRequiredMs) {
        console.log(
          `[Scheduler] Context "${context.name}" interval reached ` +
          `(${intervalMinutes}m base + ${Math.round(jitterMs / 1000)}s jitter). Firing drop...`
        );
        await this.executeDrop({
          contextId: context.id,
          source: 'scheduler',
        });
      }
      return;
    }

    // MODE 2: FIXED TIMES (e.g. ["06:00", "18:00"])
    const nowDate = new Date(now);
    const timezone = schedule.timezone || 'America/Los_Angeles';

    const timeInZone = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(nowDate);

    const dateInZone = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(nowDate);

    const currentSlotKey = `${dateInZone}-${timeInZone}`;
    const matchedTime = (schedule.scheduleTimes || []).find((t) => t === timeInZone);

    if (matchedTime && context.lastPostedSlot !== currentSlotKey) {
      const isMorning = matchedTime.startsWith('06') || matchedTime.startsWith('6');
      context.lastPostedSlot = currentSlotKey;
      storage.updateContext(context.id, { lastPostedSlot: currentSlotKey });

      console.log(`[Scheduler] Context "${context.name}" fixed time reached (${matchedTime}). Firing drop...`);
      await this.executeDrop({
        contextId: context.id,
        slotType: isMorning ? 'morning' : 'evening',
        source: 'scheduler',
      });
    }
  }

  public getNextScheduledPost(contextId?: string) {
    const context = contextId ? (storage.getContext(contextId) || storage.getActiveContext()) : storage.getActiveContext();
    return this.calculateNextPostForContext(context);
  }

  public getAllNextScheduledPosts() {
    return storage.getContexts().map(c => ({
      contextId: c.id,
      contextName: c.name,
      enabled: c.enabled,
      targetTweetId: c.targetTweetId,
      ...this.calculateNextPostForContext(c),
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

      const jitterFormatted = jitterSeconds > 0
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
    const nowDate = new Date(now);
    const timezone = schedule.timezone || 'America/Los_Angeles';
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hour12: false,
    });

    const parts = formatter.formatToParts(nowDate);
    const getVal = (type: string) => parseInt(parts.find((p) => p.type === type)?.value || '0', 10);
    const curHour = getVal('hour');
    const curMinute = getVal('minute');
    const curSecond = getVal('second');

    const curSecondsOfDay = curHour * 3600 + curMinute * 60 + curSecond;

    const parsedSlots = (schedule.scheduleTimes || ['06:00', '18:00'])
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
    let secondsUntil = 0;

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
