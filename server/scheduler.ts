/**
 * Scheduler service for X ChromaBot
 * Supports:
 *  1) Interval repeats: every 1m, 15m, 30m, 60m (1h), 3h, 6h, 9h, 12h
 *  2) Fixed clock drops: e.g. 6:00 AM & 6:00 PM in chosen timezone
 *  3) Direct autonomous Webhook / Cron trigger
 */

import { formatTweetText, generateColor, ColorData } from './colorEngine.js';
import { storage } from './storage.js';
import { postColorTweet } from './twitterClient.js';

export interface ExecuteDropOptions {
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
    // Check every 10 seconds for high precision
    this.timer = setInterval(() => this.tick(), 10 * 1000);
    console.log('[Scheduler] Started chromatic post scheduler engine.');
  }

  public stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.log('[Scheduler] Stopped.');
  }

  /**
   * Core execute function used by internal timer, webhook trigger, or manual API call.
   */
  public async executeDrop(options: ExecuteDropOptions = {}) {
    const settings = storage.getSettings();
    const isMorning = options.slotType
      ? options.slotType === 'morning'
      : (new Date().getUTCHours() - 7 + 24) % 24 < 12;

    const slotType = options.slotType || (isMorning ? 'morning' : 'evening');
    const color: ColorData = storage.popNextQueueSlot(slotType === 'morning' ? 'morning' : 'evening');
    const timeTag = isMorning ? '6:00 AM' : '6:00 PM';
    const text = formatTweetText(settings.template, color, timeTag);

    const isDryRun = options.forceLive ? false : settings.dryRun;
    const creds = storage.getEffectiveCredentials();

    console.log(`[Scheduler] Executing chromatic drop (source: ${options.source || 'manual'}, mode: ${isDryRun ? 'DRY-RUN' : 'LIVE X'})`);

    const tweetRes = await postColorTweet(
      creds,
      {
        text,
        replyToTweetId: settings.targetTweetId,
      },
      isDryRun
    );

    const now = Date.now();
    storage.setLastPostedTimestamp(now);

    const logEntry = {
      id: `log_${now}`,
      timestamp: new Date().toISOString(),
      slotType,
      targetTweetId: settings.targetTweetId,
      color,
      tweetText: text,
      tweetId: tweetRes.tweetId,
      tweetUrl: tweetRes.url,
      status: tweetRes.success ? (tweetRes.simulated ? ('simulated' as const) : ('success' as const)) : ('error' as const),
      errorMessage: tweetRes.error,
    };

    storage.addLog(logEntry);

    return {
      success: tweetRes.success,
      result: tweetRes,
      log: logEntry,
    };
  }

  public async tick() {
    const settings = storage.getSettings();
    if (!settings.schedulerEnabled || this.isProcessing) {
      return;
    }

    try {
      this.isProcessing = true;
      const now = Date.now();

      // MODE 1: INTERVAL-BASED (e.g. Every 1m, 15m, 30m, 60m, 3h, 6h, 9h, 12h)
      if (settings.intervalMode === 'interval') {
        const intervalMinutes = settings.intervalMinutes || 720;
        const intervalMs = intervalMinutes * 60 * 1000;
        const lastPosted = storage.getLastPostedTimestamp();

        // If never posted before, fire now; or if elapsed time is >= intervalMs
        if (!lastPosted || (now - lastPosted) >= intervalMs) {
          console.log(`[Scheduler] Interval trigger: ${intervalMinutes} minutes elapsed. Firing drop...`);
          await this.executeDrop({ source: 'scheduler' });
        }
        return;
      }

      // MODE 2: FIXED TIMES (e.g. ["06:00", "18:00"])
      const nowDate = new Date(now);
      const timeInZone = new Intl.DateTimeFormat('en-US', {
        timeZone: settings.timezone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(nowDate);

      const dateInZone = new Intl.DateTimeFormat('en-CA', {
        timeZone: settings.timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(nowDate);

      const currentSlotKey = `${dateInZone}-${timeInZone}`;
      const matchedTime = settings.scheduleTimes.find((t) => t === timeInZone);

      if (matchedTime && storage.getLastPostedSlot() !== currentSlotKey) {
        console.log(`[Scheduler] Fixed time trigger for ${currentSlotKey} (${matchedTime})`);
        const isMorning = matchedTime.startsWith('06') || matchedTime.startsWith('6');
        storage.setLastPostedSlot(currentSlotKey);
        await this.executeDrop({
          slotType: isMorning ? 'morning' : 'evening',
          source: 'scheduler',
        });
      }
    } catch (err) {
      console.error('[Scheduler] Error during schedule tick:', err);
    } finally {
      this.isProcessing = false;
    }
  }

  public getNextScheduledPost() {
    const settings = storage.getSettings();
    const now = Date.now();

    // If Interval Mode
    if (settings.intervalMode === 'interval') {
      const intervalMinutes = settings.intervalMinutes || 720;
      const intervalSeconds = intervalMinutes * 60;
      const lastPosted = storage.getLastPostedTimestamp();
      
      let secondsUntil = intervalSeconds;
      if (lastPosted) {
        const elapsedSeconds = Math.floor((now - lastPosted) / 1000);
        secondsUntil = Math.max(0, intervalSeconds - elapsedSeconds);
      }

      const hours = Math.floor(secondsUntil / 3600);
      const minutes = Math.floor((secondsUntil % 3600) / 60);
      const seconds = secondsUntil % 60;

      const formatIntervalLabel = (mins: number) => {
        if (mins < 60) return `Every ${mins} minute${mins === 1 ? '' : 's'}`;
        const hrs = mins / 60;
        return `Every ${hrs} hour${hrs === 1 ? '' : 's'}`;
      };

      return {
        slotTime: `Every ${intervalMinutes}m`,
        label: formatIntervalLabel(intervalMinutes),
        isMorning: false,
        secondsUntil,
        countdownFormatted: `${hours}h ${minutes}m ${seconds}s`,
        targetTimezone: 'Repeating Interval',
      };
    }

    // Fixed Times Mode
    const nowDate = new Date(now);
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: settings.timezone,
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

    const parsedSlots = settings.scheduleTimes
      .map((timeStr) => {
        const [h, m] = timeStr.split(':').map(Number);
        return {
          timeStr,
          secondsOfDay: h * 3600 + m * 60,
          isMorning: h < 12,
          label: h === 6 ? '6:00 AM Morning Drop' : h === 18 ? '6:00 PM Evening Drop' : `${timeStr} Drop`,
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
      return null;
    }

    const hours = Math.floor(secondsUntil / 3600);
    const minutes = Math.floor((secondsUntil % 3600) / 60);
    const seconds = secondsUntil % 60;

    return {
      slotTime: nextSlot.timeStr,
      label: nextSlot.label,
      isMorning: nextSlot.isMorning,
      secondsUntil,
      countdownFormatted: `${hours}h ${minutes}m ${seconds}s`,
      targetTimezone: settings.timezone,
    };
  }
}

export const scheduler = new SchedulerService();
