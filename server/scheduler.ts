/**
 * Scheduler service for X ChromaBot
 * Manages daily automated color posting at 6:00 AM and 6:00 PM in the configured timezone.
 */

import { formatTweetText } from './colorEngine.js';
import { storage } from './storage.js';
import { postColorTweet } from './twitterClient.js';

class SchedulerService {
  private timer: NodeJS.Timeout | null = null;
  private isProcessing = false;

  public start() {
    if (this.timer) {
      clearInterval(this.timer);
    }
    // Check every 30 seconds
    this.timer = setInterval(() => this.tick(), 30 * 1000);
    console.log('[Scheduler] Started 6am & 6pm chromatic post watcher.');
  }

  public stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.log('[Scheduler] Stopped.');
  }

  public async tick() {
    const settings = storage.getSettings();
    if (!settings.schedulerEnabled) {
      return;
    }
    if (this.isProcessing) {
      return;
    }

    try {
      this.isProcessing = true;
      const now = new Date();

      // Format time in target timezone
      const timeInZone = new Intl.DateTimeFormat('en-US', {
        timeZone: settings.timezone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(now);

      const dateInZone = new Intl.DateTimeFormat('en-CA', {
        timeZone: settings.timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(now);

      const currentSlotKey = `${dateInZone}-${timeInZone}`;

      // Check if current HH:MM matches one of the scheduled times (e.g., "06:00", "18:00")
      const matchedTime = settings.scheduleTimes.find(t => t === timeInZone);

      if (matchedTime && storage.getLastPostedSlot() !== currentSlotKey) {
        console.log(`[Scheduler] Triggering scheduled post for slot ${currentSlotKey} (${matchedTime})`);
        
        const isMorning = matchedTime.startsWith('06') || matchedTime.startsWith('6');
        const slotType = isMorning ? 'morning' : 'evening';
        const color = storage.popNextQueueSlot(slotType);
        const timeTag = isMorning ? '6:00 AM' : '6:00 PM';
        const text = formatTweetText(settings.template, color, timeTag);

        const creds = storage.getEffectiveCredentials();
        const tweetRes = await postColorTweet(
          creds,
          {
            text,
            replyToTweetId: settings.targetTweetId,
          },
          settings.dryRun
        );

        // Record log
        storage.addLog({
          id: `log_${Date.now()}`,
          timestamp: new Date().toISOString(),
          slotType,
          scheduledTime: matchedTime,
          targetTweetId: settings.targetTweetId,
          color,
          tweetText: text,
          tweetId: tweetRes.tweetId,
          tweetUrl: tweetRes.url,
          status: tweetRes.success ? (tweetRes.simulated ? 'simulated' : 'success') : 'error',
          errorMessage: tweetRes.error,
        });

        storage.setLastPostedSlot(currentSlotKey);
        console.log(`[Scheduler] Post completed for ${currentSlotKey}. Result:`, tweetRes.success ? 'OK' : tweetRes.error);
      }
    } catch (err) {
      console.error('[Scheduler] Error during schedule tick:', err);
    } finally {
      this.isProcessing = false;
    }
  }

  public getNextScheduledPost() {
    const settings = storage.getSettings();
    const now = new Date();

    // Get current date parts in timezone
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

    const parts = formatter.formatToParts(now);
    const getVal = (type: string) => parseInt(parts.find(p => p.type === type)?.value || '0', 10);
    const curHour = getVal('hour');
    const curMinute = getVal('minute');
    const curSecond = getVal('second');

    const curSecondsOfDay = curHour * 3600 + curMinute * 60 + curSecond;

    // Convert schedule times (e.g. ["06:00", "18:00"]) into seconds of day
    const parsedSlots = settings.scheduleTimes.map(timeStr => {
      const [h, m] = timeStr.split(':').map(Number);
      return {
        timeStr,
        secondsOfDay: h * 3600 + m * 60,
        isMorning: h < 12,
        label: h === 6 ? '6:00 AM Morning Drop' : h === 18 ? '6:00 PM Evening Drop' : `${timeStr} Drop`,
      };
    }).sort((a, b) => a.secondsOfDay - b.secondsOfDay);

    // Find next upcoming slot today or first slot tomorrow
    let nextSlot = parsedSlots.find(s => s.secondsOfDay > curSecondsOfDay);
    let secondsUntil = 0;

    if (nextSlot) {
      secondsUntil = nextSlot.secondsOfDay - curSecondsOfDay;
    } else if (parsedSlots.length > 0) {
      nextSlot = parsedSlots[0];
      secondsUntil = (86400 - curSecondsOfDay) + nextSlot.secondsOfDay;
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
