/**
 * Rate-limit, cooldown and anti-spam telemetry.
 */

import type { CooldownState, RateLimitHeaders, RateLimitTelemetry } from '../../shared/types.js';
import type { StateManager } from './stateManager.js';

type Tier = RateLimitTelemetry['tierDetected'];

const detectTier = (
  limit: number,
  headers?: RateLimitHeaders,
): { tierDetected: Tier; estimatedDailyCap: number } => {
  if (limit <= 17 || headers?.appDailyLimit === 17) {
    return { tierDetected: 'Free (Legacy)', estimatedDailyCap: 17 };
  }
  if (headers?.appDailyLimit === 100 || headers?.userDailyLimit === 100) {
    return { tierDetected: 'Basic ($200/mo)', estimatedDailyCap: 100 };
  }
  if (limit >= 100) {
    return { tierDetected: 'Pro ($5k/mo)', estimatedDailyCap: 10000 };
  }
  return { tierDetected: 'Pay-Per-Use ($0.015/tweet)', estimatedDailyCap: 10000 };
};

export class RateLimitService {
  constructor(private readonly sm: StateManager) {}

  getCooldownState(): CooldownState {
    const s = this.sm.state;
    const now = Date.now();
    const isThrottled = s.cooldownUntilMs > now;
    return {
      isThrottled,
      throttledUntil: s.cooldownUntilMs,
      secondsRemaining: isThrottled ? Math.ceil((s.cooldownUntilMs - now) / 1000) : 0,
      reason: isThrottled ? s.cooldownReason : undefined,
      lastThrottledAt: s.lastThrottledAt || undefined,
    };
  }

  setGlobalCooldown(durationMinutes: number, reason: string) {
    const s = this.sm.state;
    s.cooldownUntilMs = Date.now() + durationMinutes * 60 * 1000;
    s.cooldownReason = reason;
    s.lastThrottledAt = new Date().toISOString();
    console.log(`[RateLimit] Set global X API cooldown for ${durationMinutes} minutes: ${reason}`);
    this.sm.persist();
  }

  clearGlobalCooldown() {
    this.sm.state.cooldownUntilMs = 0;
    this.sm.state.cooldownReason = '';
    console.log(`[RateLimit] Cleared global X API cooldown.`);
    this.sm.persist();
  }

  recordLivePostTimestamp() {
    this.sm.state.lastGlobalLivePostTimestamp = Date.now();
  }

  getTimeSinceLastLivePostMs(): number {
    const last = this.sm.state.lastGlobalLivePostTimestamp;
    return last ? Date.now() - last : Infinity;
  }

  updateRateLimitTelemetry(headers?: RateLimitHeaders) {
    if (headers && (headers.limit !== undefined || headers.remaining !== undefined)) {
      this.sm.state.lastCapturedRateLimitHeaders = headers;
      this.sm.state.lastRateLimitCaptureTimestamp = Date.now();
      this.sm.persist();
    }
  }

  getRateLimitTelemetry(): RateLimitTelemetry {
    const s = this.sm.state;
    const now = Date.now();
    const cooldown = this.getCooldownState();

    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    const postsLast24Hours = s.logs.filter(
      (l) =>
        l.status === 'success' &&
        !l.tweetId?.startsWith('sim_') &&
        new Date(l.timestamp).getTime() >= oneDayAgo,
    ).length;

    const headers = s.lastCapturedRateLimitHeaders;
    const limit = headers?.limit ?? 50;
    const remaining = headers?.remaining ?? (cooldown.isThrottled ? 0 : 50);
    const resetEpochSeconds = headers?.reset ?? Math.floor((now + 15 * 60 * 1000) / 1000);
    const { tierDetected, estimatedDailyCap } = detectTier(limit, headers);

    let status: RateLimitTelemetry['status'] = 'optimal';
    if (
      cooldown.isThrottled ||
      remaining === 0 ||
      (estimatedDailyCap <= 100 && postsLast24Hours >= estimatedDailyCap)
    ) {
      status = 'throttled';
    } else if (
      remaining < 5 ||
      (estimatedDailyCap <= 100 && postsLast24Hours >= estimatedDailyCap * 0.8)
    ) {
      status = 'warning';
    }

    return {
      limit,
      remaining,
      resetEpochSeconds,
      resetDateIso: new Date(resetEpochSeconds * 1000).toISOString(),
      secondsUntilReset: Math.max(0, resetEpochSeconds - Math.floor(now / 1000)),
      status,
      postsLast24Hours,
      estimatedDailyCap,
      lastUpdatedIso: s.lastRateLimitCaptureTimestamp
        ? new Date(s.lastRateLimitCaptureTimestamp).toISOString()
        : new Date().toISOString(),
      tierDetected,
      headersCaptured: !!headers,
      activeCooldown: cooldown.isThrottled ? cooldown : undefined,
    };
  }
}
