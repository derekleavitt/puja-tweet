/**
 * Scheduler service for X ChromaBot
 * Multi-Context Autonomous Engine:
 *  - Checks every enabled Tweet Context on each tick.
 *  - Evaluates individual schedules (Interval or Fixed Clock Times).
 *  - Applies humanized anti-bot jitter per context.
 *  - Dispatches targeted replies to each context's specific targetTweetId.
 */

import { ColorData } from './colorEngine.js';
import { resolveTemplateText } from './templateAgent.js';
import { HttpError } from './middleware/error.js';
import { services } from './services/index.js';
import type { TweetContext } from '../shared/types.js';
import { postColorTweet } from './twitterClient.js';

export interface ExecuteDropOptions {
  contextId?: string;
  slotType?: 'morning' | 'evening' | 'manual';
  color?: ColorData;
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
    const requested = options.contextId
      ? services.contexts.getContext(options.contextId)
      : undefined;
    if (options.contextId && !requested) {
      throw new HttpError(404, `Context ${options.contextId} not found`);
    }
    const context: TweetContext = requested || services.contexts.getActiveContext();

    const isMorning = options.slotType
      ? options.slotType === 'morning'
      : (new Date().getUTCHours() - 7 + 24) % 24 < 12;

    const slotType = options.slotType || (isMorning ? 'morning' : 'evening');
    const color: ColorData =
      options.color ||
      services.queue.popNextQueueSlot(slotType === 'morning' ? 'morning' : 'evening', context.id);
    const timeTag = isMorning ? '6:00 AM' : '6:00 PM';
    const text = await resolveTemplateText(context.template, color, {
      slotLabel: timeTag,
      contextId: context.id,
      targetTweetId: context.targetTweetId,
    });

    const engagementMode = context.engagementMode || 'reply';
    let replyToTweetId: string | undefined = undefined;
    let quoteTweetId: string | undefined = undefined;
    const replyTargetInfo = services.contexts.getEffectiveReplyTargetId(context);

    if (engagementMode === 'reply') {
      replyToTweetId = replyTargetInfo.targetTweetId;
    } else if (engagementMode === 'quote') {
      quoteTweetId = context.targetTweetId;
    }

    const isDryRun = options.forceLive ? false : (context.dryRun ?? false);
    const creds = services.credentials.getEffectiveCredentials();

    console.log(
      `[Scheduler] Executing drop for context "${context.name}" (${context.id}) ` +
        `-> Mode: ${engagementMode.toUpperCase()} ` +
        `${engagementMode === 'reply' ? `(Target #${replyToTweetId}, ${context.replyTargetMode === 'last_comment' ? (replyTargetInfo.isFirstInChain ? 'Initiating cascade from root' : 'Cascading reply to last comment') : 'Direct reply to original root'})` : ''}` +
        `${engagementMode === 'quote' ? `(Quoting Post #${quoteTweetId})` : ''}` +
        `${engagementMode === 'standalone' ? '(Timeline post)' : ''}` +
        `, source: ${options.source || 'manual'}, mode: ${isDryRun ? 'DRY-RUN' : 'LIVE X'}`,
    );

    let finalTweetRes = await postColorTweet(
      creds,
      {
        text,
        replyToTweetId,
        quoteTweetId,
        engagementMode,
      },
      isDryRun,
    );

    // AUTO-RECOVERY: If replyTargetMode was 'last_comment' and the reply to the previous comment failed
    // due to the previous comment being deleted/invalid (NOT a temporary rate limit or cooldown),
    // reset broken chain anchor back to root post and retry once on root.
    if (
      !finalTweetRes.success &&
      engagementMode === 'reply' &&
      context.replyTargetMode === 'last_comment' &&
      !replyTargetInfo.isFirstInChain
    ) {
      const isThrottleOrCooldown =
        finalTweetRes.isRateLimitOrCooldown ||
        finalTweetRes.error?.includes('cooldown') ||
        finalTweetRes.error?.includes('not permitted to access this feature') ||
        finalTweetRes.error?.includes('Credits Depleted') ||
        finalTweetRes.error?.includes('Payment Required') ||
        finalTweetRes.rawResponse?.status === 429;

      if (!isThrottleOrCooldown) {
        console.log(
          `[Scheduler] Cascading anchor #${replyToTweetId} for context "${context.name}" appears deleted or invalid (${finalTweetRes.error}). Resetting anchor to primary root post #${context.targetTweetId}.`,
        );
        context.lastPostedTweetId = undefined;
        services.contexts.resetContextChain(context.id);

        if (!isDryRun) {
          const fallbackRes = await postColorTweet(
            creds,
            {
              text,
              replyToTweetId: context.targetTweetId,
              engagementMode: 'reply',
            },
            isDryRun,
          );
          if (fallbackRes.success) {
            finalTweetRes = fallbackRes;
          }
        }
      } else {
        console.log(
          `[Scheduler] Preserving chain anchor #${replyToTweetId} for context "${context.name}" during temporary X cooldown.`,
        );
      }
    }

    // Update rate limit telemetry from headers
    if (finalTweetRes.rateLimitHeaders) {
      services.rateLimit.updateRateLimitTelemetry(finalTweetRes.rateLimitHeaders);
    }

    // Set global cooldown if X returned rate limit or cooldown
    if (
      !isDryRun &&
      (finalTweetRes.isRateLimitOrCooldown ||
        finalTweetRes.rawResponse?.status === 429 ||
        finalTweetRes.error?.includes('cooldown') ||
        finalTweetRes.error?.includes('not permitted to access this feature'))
    ) {
      services.rateLimit.setGlobalCooldown(
        15,
        finalTweetRes.error || 'X API Rate Limit / Reply Cooldown Active',
      );
    }

    // Record live post timestamp for anti-burst spacing
    if (!isDryRun && finalTweetRes.success) {
      services.rateLimit.recordLivePostTimestamp();
    }

    const now = Date.now();
    const status = finalTweetRes.success
      ? finalTweetRes.simulated
        ? ('simulated' as const)
        : ('success' as const)
      : ('error' as const);

    // Record stats, roll jitter, and update lastPostedTweetId for chain continuity (only for actual replies)
    services.contexts.recordContextPostResult(
      context.id,
      status,
      finalTweetRes.tweetId,
      finalTweetRes.engagementMode || engagementMode,
    );

    const logEntry = {
      id: `log_${now}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date().toISOString(),
      slotType,
      targetTweetId: context.targetTweetId,
      replyToTweetId: finalTweetRes.replyTo || replyToTweetId,
      quoteTweetId: finalTweetRes.quoteTweetId || quoteTweetId,
      engagementMode: finalTweetRes.engagementMode || engagementMode,
      color,
      tweetText: text,
      tweetId: finalTweetRes.tweetId,
      tweetUrl: finalTweetRes.url,
      status,
      errorMessage: finalTweetRes.error,
      contextId: context.id,
      contextName: context.name,
    };

    services.logs.addLog(logEntry);

    return {
      success: finalTweetRes.success,
      result: finalTweetRes,
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
        await this.executeDrop({
          contextId: context.id,
          source: 'scheduler',
        });
      }
      return;
    }

    // MODE 2: FIXED TIMES (e.g. ["06:00", "18:00"])
    const nowDate = new Date(now);
    const timezone = schedule.timezone || 'America/Denver';

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
      services.contexts.updateContext(context.id, { lastPostedSlot: currentSlotKey });

      console.log(
        `[Scheduler] Context "${context.name}" fixed time reached (${matchedTime}). Firing drop...`,
      );
      await this.executeDrop({
        contextId: context.id,
        slotType: isMorning ? 'morning' : 'evening',
        source: 'scheduler',
      });
    }
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
    const nowDate = new Date(now);
    const timezone = schedule.timezone || 'America/Denver';
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
