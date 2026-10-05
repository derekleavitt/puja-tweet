/**
 * Tweet context (campaign) domain logic: CRUD, active context, chain anchors and post results.
 */

import { DEFAULT_TWEET_TEMPLATE } from '../colorEngine.js';
import { HttpError } from '../middleware/error.js';
import { extractTweetId } from '../../shared/tweetId.js';
import { getDefaultTargetTweetId } from '../store/defaults.js';
import { normaliseEvolution } from '../../shared/hashtags/index.js';
import type {
  HashtagState,
  PendingFire,
  TweetContext,
  TweetContextSchedule,
} from '../../shared/types.js';
import {
  generateJitterForContext,
  resolveLastPostedTweetId,
  resolveReplyTarget,
  sanitizeContextChain,
  type EffectiveReplyTarget,
} from './contextChain.js';
import type { XErrorClass } from '../xErrors.js';
import { buildPrimaryContext } from './primaryContext.js';
import { parseContextUpdate } from './contextSchema.js';
import type { QueueService } from './queueService.js';
import { syncActiveContextToSettings } from './settingsMirror.js';
import type { StateManager } from './stateManager.js';

const cleanTweetId = (input: string): string => extractTweetId(input) ?? input.trim();

export type ContextPatch = Partial<Omit<TweetContext, 'schedule'>> & {
  schedule?: Partial<TweetContextSchedule>;
};

/** Create/update input: `hashtagEvolution` may be partial (gaps are filled from defaults). */
type ContextInput = Omit<ContextPatch, 'hashtagEvolution'> & {
  hashtagEvolution?: Partial<NonNullable<TweetContext['hashtagEvolution']>>;
};

/** Consecutive errors before a campaign auto-pauses (env MAX_CONSECUTIVE_ERRORS, default 5). */
const maxConsecutiveErrors = (): number => {
  const n = Number(process.env.MAX_CONSECUTIVE_ERRORS);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 5;
};

const notFound = (id: string) => new HttpError(404, `Context ${id} not found`);

export class ContextService {
  constructor(
    private readonly sm: StateManager,
    private readonly queue: QueueService,
  ) {}

  /** Boot-time: creates the primary context on first run and repairs polluted chains. */
  ensureDefaultContext() {
    const s = this.sm.state;
    if (s.contexts.length === 0) {
      const primary = buildPrimaryContext(s);
      s.contexts.push(primary);
      s.activeContextId = primary.id;
      this.sm.persist();
      return;
    }

    if (!s.contexts.some((c) => c.id === s.activeContextId)) {
      s.activeContextId = s.contexts[0].id;
    }
    let modified = false;
    for (const ctx of s.contexts) {
      if (sanitizeContextChain(ctx, s.logs)) modified = true;
    }
    if (modified) this.sm.persist();
  }

  getContexts(): TweetContext[] {
    return this.sm.state.contexts;
  }

  getContext(id: string): TweetContext | undefined {
    return this.sm.getContext(id);
  }

  getActiveContext(): TweetContext {
    return this.sm.getActiveContext();
  }

  setActiveContextId(id: string): TweetContext {
    const found = this.sm.getContext(id);
    if (!found) return this.getActiveContext();
    this.sm.state.activeContextId = id;
    this.sm.state.settings.activeContextId = id;
    syncActiveContextToSettings(this.sm.state.settings, found);
    this.sm.persist();
    return found;
  }

  createContext(data: ContextInput): TweetContext {
    const s = this.sm.state;
    const id = data.id || `ctx_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const newContext: TweetContext = {
      id,
      name: data.name?.trim() || `Context #${s.contexts.length + 1}`,
      description: data.description?.trim() || '',
      targetTweetId: cleanTweetId(
        data.targetTweetId || s.settings.targetTweetId || getDefaultTargetTweetId(),
      ),
      replyTargetMode: data.replyTargetMode || 'original_post',
      engagementMode: data.engagementMode || 'reply',
      autoFallbackToQuote: data.autoFallbackToQuote ?? false,
      lastPostedTweetId: data.lastPostedTweetId,
      enabled: data.enabled ?? true,
      dryRun: data.dryRun ?? false,
      schedule: {
        mode: data.schedule?.mode || 'interval',
        intervalMinutes: data.schedule?.intervalMinutes || 60,
        scheduleTimes: data.schedule?.scheduleTimes || ['06:00', '18:00'],
        timezone: data.schedule?.timezone || s.settings.timezone || 'America/Denver',
        humanizeJitterEnabled: data.schedule?.humanizeJitterEnabled ?? true,
        jitterPercentage: data.schedule?.jitterPercentage ?? 25,
      },
      template: data.template?.trim() || DEFAULT_TWEET_TEMPLATE,
      themePreference: data.themePreference || 'dynamic',
      hashtagEvolution: normaliseEvolution(data.hashtagEvolution),
      lastPostedTimestamp: data.lastPostedTimestamp || Date.now(), // never fire on create
      currentJitterMs: data.currentJitterMs || 0,
      createdAt: data.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      stats: data.stats || { totalPosts: 0, successfulPosts: 0, simulatedPosts: 0, failedPosts: 0 },
    };

    sanitizeContextChain(newContext, s.logs);
    generateJitterForContext(newContext);

    s.contexts.push(newContext);
    this.queue.clearAndRegenerateQueue(newContext.id);
    this.sm.persist();
    return newContext;
  }

  /**
   * Client-facing update: only whitelisted fields are accepted (see `contextSchema.ts`);
   * invalid input throws HttpError(400), an unknown id HttpError(404).
   */
  updateContext(id: string, body: unknown): TweetContext {
    if (!this.sm.getContext(id)) throw notFound(id);
    const input = parseContextUpdate(body);
    const current = this.sm.getContext(id);
    const { hashtagEvolution, ...rest } = input;
    return this.patchContext(id, {
      ...rest,
      ...(hashtagEvolution
        ? { hashtagEvolution: normaliseEvolution(current?.hashtagEvolution, hashtagEvolution) }
        : {}),
    });
  }

  /** Server-owned bookkeeping: stores the evolved hashtags of a successful post (no queue reset). */
  setHashtagState(id: string, state: HashtagState): TweetContext {
    const current = this.sm.getContext(id);
    if (!current) throw notFound(id);
    current.hashtagState = state;
    this.sm.persist();
    return current;
  }

  /** Internal update for trusted callers (scheduler bookkeeping); no field whitelist. */
  patchContext(id: string, updates: ContextPatch): TweetContext {
    const s = this.sm.state;
    const idx = s.contexts.findIndex((c) => c.id === id);
    if (idx === -1) throw notFound(id);

    const current = s.contexts[idx];
    const targetTweetId = updates.targetTweetId
      ? cleanTweetId(updates.targetTweetId)
      : current.targetTweetId;
    const targetChanged = targetTweetId !== current.targetTweetId;

    const mergedSchedule: TweetContextSchedule = {
      ...current.schedule,
      ...(updates.schedule || {}),
    };
    const scheduleChanged =
      (updates.schedule?.intervalMinutes !== undefined &&
        updates.schedule.intervalMinutes !== current.schedule.intervalMinutes) ||
      (updates.schedule?.mode !== undefined && updates.schedule.mode !== current.schedule.mode);

    const resumed = updates.enabled === true && !current.enabled;

    const updated: TweetContext = {
      ...current,
      ...updates,
      // Re-enabling restarts the interval from now and clears any circuit-breaker state.
      ...(resumed
        ? { lastPostedTimestamp: Date.now(), consecutiveErrors: 0, autoPausedReason: undefined }
        : {}),
      id: current.id, // Never allow id to be overwritten
      targetTweetId,
      replyTargetMode: updates.replyTargetMode ?? (current.replyTargetMode || 'original_post'),
      engagementMode: updates.engagementMode ?? (current.engagementMode || 'reply'),
      autoFallbackToQuote: updates.autoFallbackToQuote ?? current.autoFallbackToQuote ?? false,
      lastPostedTweetId: targetChanged
        ? updates.lastPostedTweetId || undefined
        : 'lastPostedTweetId' in updates
          ? updates.lastPostedTweetId || undefined
          : current.lastPostedTweetId,
      schedule: mergedSchedule,
      updatedAt: new Date().toISOString(),
    };

    sanitizeContextChain(updated, s.logs);
    if (scheduleChanged) generateJitterForContext(updated);

    s.contexts[idx] = updated;
    if (s.activeContextId === id) syncActiveContextToSettings(s.settings, updated);

    // Any save/edit of a campaign clears its queue and regenerates based on the new settings
    this.queue.clearAndRegenerateQueue(id);
    this.sm.persist();
    return updated;
  }

  /** Starts the interval clock from `at` (legacy contexts stored with 0); no queue regeneration. */
  setContextLastPostedTimestamp(contextId: string, at: number) {
    const ctx = this.sm.getContext(contextId);
    if (!ctx) return;
    ctx.lastPostedTimestamp = at;
    this.sm.persist();
  }

  /** Persists only the last fired fixed-time slot key (no queue regeneration). */
  setContextLastPostedSlot(contextId: string, slotKey: string) {
    const ctx = this.sm.getContext(contextId);
    if (!ctx) return;
    ctx.lastPostedSlot = slotKey;
    this.sm.persist();
  }

  /** Persists (or clears, with undefined) the armed fixed-time fire so restarts don't lose it. */
  setContextPendingFire(contextId: string, pending: PendingFire | undefined) {
    const ctx = this.sm.getContext(contextId);
    if (!ctx) return;
    ctx.pendingFire = pending;
    this.sm.persist();
  }

  deleteContext(id: string): boolean {
    const s = this.sm.state;
    if (s.contexts.length <= 1) {
      throw new HttpError(
        400,
        'Cannot delete the only tweet context. At least one context must remain.',
      );
    }
    const idx = s.contexts.findIndex((c) => c.id === id);
    if (idx === -1) return false;

    s.contexts.splice(idx, 1);
    s.queue = s.queue.filter((q) => q.contextId !== id);
    if (s.activeContextId === id) {
      s.activeContextId = s.contexts[0].id;
      syncActiveContextToSettings(s.settings, s.contexts[0]);
    }
    this.sm.persist();
    return true;
  }

  duplicateContext(id: string): TweetContext {
    const source = this.sm.getContext(id);
    if (!source) throw notFound(id);
    return this.createContext({
      name: `${source.name} (Copy)`,
      description: source.description,
      targetTweetId: source.targetTweetId,
      replyTargetMode: source.replyTargetMode || 'original_post',
      engagementMode: source.engagementMode || 'reply',
      autoFallbackToQuote: source.autoFallbackToQuote ?? false,
      lastPostedTweetId: undefined, // Fresh copy starts clean
      enabled: false, // Start paused
      dryRun: source.dryRun,
      schedule: { ...source.schedule },
      template: source.template,
      themePreference: source.themePreference,
    });
  }

  toggleContext(id: string): TweetContext {
    const current = this.sm.getContext(id);
    if (!current) throw notFound(id);
    return this.patchContext(id, { enabled: !current.enabled });
  }

  resetContextChain(id: string): TweetContext {
    const current = this.sm.getContext(id);
    if (!current) throw notFound(id);
    current.lastPostedTweetId = undefined;
    if (this.sm.state.activeContextId === id) {
      this.sm.state.settings.lastPostedTweetId = undefined;
    }
    this.queue.clearAndRegenerateQueue(id);
    this.sm.persist();
    return current;
  }

  /** Drops the chain anchor only (no queue regeneration); the next reply targets the root post. */
  clearContextAnchor(id: string): TweetContext {
    const current = this.sm.getContext(id);
    if (!current) throw notFound(id);
    current.lastPostedTweetId = undefined;
    if (this.sm.state.activeContextId === id) {
      this.sm.state.settings.lastPostedTweetId = undefined;
    }
    this.sm.persist();
    return current;
  }

  getContextLastPostedTweetId(contextId: string): string | undefined {
    return resolveLastPostedTweetId(this.sm.getContext(contextId), this.sm.state.logs);
  }

  getEffectiveReplyTargetId(context: TweetContext): EffectiveReplyTarget {
    return resolveReplyTarget(context, this.sm.state.logs);
  }

  recordContextPostResult(
    contextId: string,
    status: 'success' | 'simulated' | 'error',
    postedTweetId?: string,
    engagementMode: 'reply' | 'quote' | 'standalone' = 'reply',
    failure?: { errorClass: XErrorClass; message?: string },
  ): { autoPausedReason?: string } {
    const context = this.sm.getContext(contextId);
    if (!context) return {};
    let autoPausedReason: string | undefined;

    if (!context.stats) {
      context.stats = { totalPosts: 0, successfulPosts: 0, simulatedPosts: 0, failedPosts: 0 };
    }
    context.stats.totalPosts += 1;
    if (status === 'success') context.stats.successfulPosts += 1;
    if (status === 'simulated') context.stats.simulatedPosts += 1;
    if (status === 'error') {
      context.stats.failedPosts += 1;
      // Throttling (429 / reply cooldown) is handled by the global cooldown, not the breaker.
      const throttled = failure?.errorClass === 'rate_limit' || failure?.errorClass === 'cooldown';
      if (!throttled) context.consecutiveErrors = (context.consecutiveErrors || 0) + 1;
      autoPausedReason = this.breakerReason(context, failure);
      if (autoPausedReason) {
        context.enabled = false;
        context.autoPausedReason = autoPausedReason;
        console.warn(`[Context] Auto-paused "${context.name}": ${autoPausedReason}`);
      }
      // Safety anti-hammer backoff: after an error (such as an X reply cooldown), back off
      // by at least 15 minutes so the developer account has time to clear the cooldown
      const intervalMs = (context.schedule.intervalMinutes || 15) * 60 * 1000;
      const minRetryDelayMs = 15 * 60 * 1000;
      context.lastPostedTimestamp =
        intervalMs < minRetryDelayMs ? Date.now() + (minRetryDelayMs - intervalMs) : Date.now();
    } else {
      context.consecutiveErrors = 0;
      context.lastPostedTimestamp = Date.now();
    }

    // Only update lastPostedTweetId if this was a genuine in-thread reply
    if (
      postedTweetId &&
      status === 'success' &&
      engagementMode === 'reply' &&
      /^\d+$/.test(postedTweetId)
    ) {
      context.lastPostedTweetId = postedTweetId;
      if (this.sm.state.activeContextId === contextId) {
        this.sm.state.settings.lastPostedTweetId = postedTweetId;
      }
    }
    generateJitterForContext(context);
    this.sm.persist();
    return { autoPausedReason };
  }

  /** Circuit breaker: immediate on X 401/402, otherwise after MAX_CONSECUTIVE_ERRORS in a row. */
  private breakerReason(
    context: TweetContext,
    failure?: { errorClass: XErrorClass; message?: string },
  ): string | undefined {
    if (!context.enabled) return undefined;
    if (failure?.errorClass === 'auth') {
      return 'X rejected the credentials (HTTP 401). Fix them, then resume.';
    }
    if (failure?.errorClass === 'payment') {
      return 'X reports no credits / payment required (HTTP 402). Add credits, then resume.';
    }
    const max = maxConsecutiveErrors();
    if ((context.consecutiveErrors || 0) >= max) {
      const last = failure?.message ? ` Last error: ${failure.message}` : '';
      return `${max} consecutive errors.${last}`.slice(0, 300);
    }
    return undefined;
  }
}
