/**
 * Rate-limit, cooldown and anti-spam telemetry.
 */

import type { CooldownState, RateLimitHeaders, RateLimitTelemetry } from '../../shared/types.js';
import type { AccountCooldown } from '../store/Store.js';
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

  private cooldownOf(accountId: string): AccountCooldown {
    return (
      this.sm.state.accountCooldowns?.[accountId] ?? { untilMs: 0, reason: '', lastThrottledAt: '' }
    );
  }

  /**
   * X cooldown of one account. Without an id: the active cooldown that ends last across every
   * account (what the header banner shows), or none.
   */
  getCooldownState(accountId?: string): CooldownState {
    const all = Object.values(this.sm.state.accountCooldowns ?? {});
    const c = accountId
      ? this.cooldownOf(accountId)
      : (all.sort((a, b) => b.untilMs - a.untilMs)[0] ?? this.cooldownOf(''));
    const now = Date.now();
    const isThrottled = c.untilMs > now;
    return {
      isThrottled,
      throttledUntil: c.untilMs,
      secondsRemaining: isThrottled ? Math.ceil((c.untilMs - now) / 1000) : 0,
      reason: isThrottled ? c.reason : undefined,
      lastThrottledAt: c.lastThrottledAt || undefined,
    };
  }

  /** Cooldown of every connected account, keyed by account id. */
  getAllCooldownStates(): Record<string, CooldownState> {
    const ids = this.sm.state.accounts.map((a) => a.id);
    return Object.fromEntries(ids.map((id) => [id, this.getCooldownState(id)]));
  }

  /** Starts an X cooldown for one account: only that account's campaigns wait it out. */
  setCooldown(durationMinutes: number, reason: string, accountId?: string) {
    if (!accountId) return;
    const s = this.sm.state;
    const entry: AccountCooldown = {
      untilMs: Date.now() + durationMinutes * 60 * 1000,
      reason,
      lastThrottledAt: new Date().toISOString(),
    };
    s.accountCooldowns = { ...s.accountCooldowns, [accountId]: entry };
    console.log(
      `[RateLimit] Set X API cooldown for ${durationMinutes} minutes (${accountId}): ${reason}`,
    );
    this.sm.persist();
  }

  /** Clears one account's cooldown, or every account's when omitted. */
  clearCooldown(accountId?: string) {
    const s = this.sm.state;
    if (!accountId) s.accountCooldowns = {};
    else if (s.accountCooldowns) delete s.accountCooldowns[accountId];
    console.log(`[RateLimit] Cleared X API cooldown (${accountId || 'all accounts'}).`);
    this.sm.persist();
  }

  /** `at` = when the post was sent (defaults to now). */
  recordLivePostTimestamp(accountId?: string, at = Date.now()) {
    if (!accountId) return;
    const s = this.sm.state;
    s.lastLivePostByAccount = { ...s.lastLivePostByAccount, [accountId]: at };
  }

  /** Time since this account's last live post (anti-burst spacing is per account). */
  getTimeSinceLastLivePostMs(accountId?: string): number {
    const last = accountId ? this.sm.state.lastLivePostByAccount?.[accountId] : undefined;
    return last ? Date.now() - last : Infinity;
  }

  updateRateLimitTelemetry(headers?: RateLimitHeaders, accountId?: string) {
    if (headers && (headers.limit !== undefined || headers.remaining !== undefined)) {
      this.sm.state.lastCapturedRateLimitHeaders = headers;
      this.sm.state.lastRateLimitCaptureTimestamp = Date.now();
      this.sm.state.lastRateLimitAccountId = accountId;
      this.sm.persist();
    }
  }

  /**
   * Seconds until X's rate window resets when the last captured headers (which are per user) came
   * from this account and say the window is used up; 0 otherwise. Never blocks another account.
   */
  getWindowExhaustedSeconds(accountId?: string): number {
    const s = this.sm.state;
    const headers = s.lastCapturedRateLimitHeaders;
    if (!accountId || s.lastRateLimitAccountId !== accountId) return 0;
    if (!headers || headers.remaining === undefined || headers.remaining > 0) return 0;
    if (headers.reset === undefined) return 0;
    return Math.max(0, Math.ceil(headers.reset - Date.now() / 1000));
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
