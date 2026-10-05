/**
 * Tweet context (campaign) domain logic: CRUD, active context, chain anchors and post results.
 */

import { DEFAULT_TWEET_TEMPLATE } from '../colorEngine.js';
import { HttpError } from '../middleware/error.js';
import { extractTweetId } from '../../shared/tweetId.js';
import { createDefaultSettings, getDefaultTargetTweetId } from '../store/defaults.js';
import {
  extractTemplateHashtags,
  formatTagBlock,
  migrateCampaignHashtags,
  normaliseCampaignTags,
  normaliseEvolution,
} from '../../shared/hashtags/index.js';
import type {
  ConversationConfig,
  ConversationState,
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
import { accountProblem, effectiveAccountId } from './accountService.js';
import { DEFAULT_ACCOUNT_ID } from '../../shared/types.js';
import { buildPrimaryContext } from './primaryContext.js';
import { parseContextUpdate } from './contextSchema.js';
import {
  initConversationState,
  repickNextSpeaker,
  validateConversation,
  type ValidatedConversation,
} from './conversationConfig.js';
import type { QueueService } from './queueService.js';
import type { StateManager } from './stateManager.js';

const cleanTweetId = (input: string): string => extractTweetId(input) ?? input.trim();

export type ContextPatch = Partial<Omit<TweetContext, 'schedule' | 'chainAnchor'>> & {
  schedule?: Partial<TweetContextSchedule>;
  /** Explicit "reset to root": drops the chain anchor. The only way a client can touch it. */
  resetChain?: boolean;
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

/** Opening line of the auto-pause reason when a conversation reached its turn limit. */
const FINISHED_PREFIX = 'Conversation finished';

/** Fields a conversation campaign always has (the speaker changes per turn; no hashtags, no quotes). */
const forceConversationFields = (ctx: TweetContext) => {
  ctx.engagementMode = 'reply';
  ctx.replyTargetMode = 'last_comment';
  ctx.autoFallbackToQuote = false;
  ctx.hashtags = [];
  ctx.hashtagEvolution = normaliseEvolution(ctx.hashtagEvolution, { enabled: false });
};

const notFound = (id: string) => new HttpError(404, `Context ${id} not found`);

export class ContextService {
  constructor(
    private readonly sm: StateManager,
    private readonly queue: QueueService,
  ) {}

  /** Stored form of an account id: undefined for the default account. Unknown ids are a 400. */
  private checkAccountId(id: string | undefined): string | undefined {
    const accountId = effectiveAccountId(id);
    if (accountId === DEFAULT_ACCOUNT_ID) return undefined;
    if (!this.sm.state.accounts.some((a) => a.id === accountId)) {
      throw new HttpError(
        400,
        `Unknown X account "${accountId}". Pick one connected under Settings, X accounts.`,
      );
    }
    return accountId;
  }

  /** Known handle of an account (no '@'); the default account's comes from its verification or X_HANDLE. */
  private handleOf(id: string): string | undefined {
    if (id === DEFAULT_ACCOUNT_ID) {
      const meta = this.sm.state.defaultAccount;
      return meta?.handle || (process.env.X_HANDLE || '').trim().replace(/^@/, '') || undefined;
    }
    return this.sm.state.accounts.find((a) => a.id === id)?.handle || undefined;
  }

  private validateConversation(config: ConversationConfig | undefined): ValidatedConversation {
    return validateConversation(config, {
      accountExists: (id) =>
        id === DEFAULT_ACCOUNT_ID || this.sm.state.accounts.some((a) => a.id === id),
      handleOf: (id) => this.handleOf(id),
    });
  }

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
      if (this.migrateHashtags(ctx)) modified = true;
    }
    if (modified) this.sm.persist();
  }

  /** Once per campaign: moves the template's literal hashtags into `hashtags` (idempotent). */
  private migrateHashtags(ctx: TweetContext): boolean {
    if (!migrateCampaignHashtags(ctx)) return false;
    if (ctx.hashtags?.length) {
      console.log(
        `[Context] Moved template hashtags of "${ctx.name}" (${ctx.id}) into its hashtags: ${formatTagBlock(ctx.hashtags)}`,
      );
    }
    return true;
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
    // Switching the active campaign changes nothing on any campaign (no settings mirror).
    this.sm.state.activeContextId = id;
    this.sm.persist();
    return found;
  }

  createContext(data: ContextInput): TweetContext {
    const s = this.sm.state;
    const id = data.id || `ctx_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    // Without explicit hashtags the template's literal tags become the campaign's hashtags.
    const template = data.template?.trim() || DEFAULT_TWEET_TEMPLATE;
    const tagged =
      data.hashtags !== undefined
        ? { template, hashtags: normaliseCampaignTags(data.hashtags) }
        : extractTemplateHashtags(template);
    const isConversation = data.mode === 'conversation';
    const validated = isConversation ? this.validateConversation(data.conversation) : undefined;
    const newContext: TweetContext = {
      id,
      name: data.name?.trim() || `Context #${s.contexts.length + 1}`,
      description: data.description?.trim() || '',
      // A conversation has no single account: the speaker changes per turn.
      accountId: isConversation ? undefined : this.checkAccountId(data.accountId),
      targetTweetId: cleanTweetId(
        // Never inherit another campaign's target (the settings mirror holds the ACTIVE campaign's).
        data.targetTweetId || getDefaultTargetTweetId(),
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
        timezone: data.schedule?.timezone || createDefaultSettings().timezone,
        humanizeJitterEnabled: data.schedule?.humanizeJitterEnabled ?? true,
        jitterPercentage: data.schedule?.jitterPercentage ?? 25,
      },
      template: tagged.template,
      hashtags: tagged.hashtags,
      themePreference: data.themePreference || 'dynamic',
      hashtagEvolution: normaliseEvolution(data.hashtagEvolution),
      // `chainAnchor` is never taken from input: a legacy anchor is only kept if a log proves it.
      lastPostedTimestamp: data.lastPostedTimestamp || Date.now(), // never fire on create
      currentJitterMs: data.currentJitterMs || 0,
      createdAt: data.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      stats: data.stats || { totalPosts: 0, successfulPosts: 0, simulatedPosts: 0, failedPosts: 0 },
    };

    if (validated) {
      newContext.mode = 'conversation';
      newContext.conversation = validated.config;
      newContext.conversationState = initConversationState(validated.config, validated.handles);
      forceConversationFields(newContext);
    } else if (data.mode === 'single') {
      newContext.mode = 'single';
    }

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
    const { hashtagEvolution, lastPostedTweetId, hashtags, ...rest } = input;
    return this.patchContext(id, {
      ...rest,
      ...(hashtags !== undefined ? { hashtags: normaliseCampaignTags(hashtags) } : {}),
      // Clients can never set an anchor; an explicit null/'' is a "reset to root".
      ...('lastPostedTweetId' in input && !lastPostedTweetId ? { resetChain: true } : {}),
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
    const { resetChain, ...fields } = updates;
    const targetTweetId = updates.targetTweetId
      ? cleanTweetId(updates.targetTweetId)
      : current.targetTweetId;
    const targetChanged = targetTweetId !== current.targetTweetId;
    // Only a change of account is validated, so a campaign whose account was removed can still be
    // edited (and is refused on resume below).
    const wasConversation = current.mode === 'conversation';
    const isConversation = (updates.mode ?? current.mode) === 'conversation';
    const modeChanged = isConversation !== wasConversation;
    const accountId = isConversation
      ? current.accountId // ignored: the speaker changes per turn
      : 'accountId' in updates &&
          effectiveAccountId(updates.accountId) !== effectiveAccountId(current.accountId)
        ? this.checkAccountId(updates.accountId)
        : current.accountId;
    const accountChanged = effectiveAccountId(accountId) !== effectiveAccountId(current.accountId);

    // A conversation is validated whenever its setup (or the mode) changes; progress restarts on a
    // new target or mode, re-picks the next speaker if the cast dropped them, and otherwise stays.
    const validated =
      isConversation && (updates.conversation || modeChanged || targetChanged)
        ? this.validateConversation(updates.conversation ?? current.conversation)
        : undefined;
    const conversation = isConversation ? (validated?.config ?? current.conversation) : undefined;
    let conversationState: ConversationState | undefined;
    if (isConversation && conversation) {
      const kept = current.conversationState;
      if (validated && (!kept || targetChanged || modeChanged)) {
        conversationState = initConversationState(conversation, validated.handles);
      } else if (!kept) {
        conversationState = initConversationState(
          conversation,
          this.validateConversation(conversation).handles,
        );
      } else if (
        !conversation.participants.some((p) => p.accountId === kept.nextSpeakerAccountId)
      ) {
        conversationState = { ...kept, nextSpeakerAccountId: repickNextSpeaker(conversation) };
      } else {
        conversationState = kept;
      }
    }

    const mergedSchedule: TweetContextSchedule = {
      ...current.schedule,
      ...(updates.schedule || {}),
    };
    const scheduleChanged =
      (updates.schedule?.intervalMinutes !== undefined &&
        updates.schedule.intervalMinutes !== current.schedule.intervalMinutes) ||
      (updates.schedule?.mode !== undefined && updates.schedule.mode !== current.schedule.mode);

    const resumed = updates.enabled === true && !current.enabled;
    // A conversation can resume only when every participant is usable.
    const blocked = !resumed
      ? undefined
      : isConversation
        ? conversation?.participants
            .map((p) => accountProblem(this.sm.state, p.accountId))
            .find(Boolean)
        : accountProblem(this.sm.state, accountId);
    if (blocked) throw new HttpError(400, `Cannot resume "${current.name}": ${blocked}.`);

    // The chain anchor is server-owned: only a target change, an account change (another account's
    // replies are a different thread) or an explicit reset moves it. A client-sent
    // `lastPostedTweetId` (e.g. the edit form echoing a stale value) is ignored.
    const keepChain = !targetChanged && !modeChanged && !accountChanged && !resetChain;
    const updated: TweetContext = {
      ...current,
      ...fields,
      // Re-enabling restarts the interval from now and clears any circuit-breaker state.
      ...(resumed
        ? { lastPostedTimestamp: Date.now(), consecutiveErrors: 0, autoPausedReason: undefined }
        : {}),
      id: current.id, // Never allow id to be overwritten
      accountId,
      targetTweetId,
      replyTargetMode: updates.replyTargetMode ?? (current.replyTargetMode || 'original_post'),
      engagementMode: updates.engagementMode ?? (current.engagementMode || 'reply'),
      autoFallbackToQuote: updates.autoFallbackToQuote ?? current.autoFallbackToQuote ?? false,
      lastPostedTweetId: keepChain ? current.lastPostedTweetId : undefined,
      chainAnchor: keepChain ? current.chainAnchor : undefined,
      schedule: mergedSchedule,
      updatedAt: new Date().toISOString(),
    };
    // Server-owned: a client/trusted patch can never set the state directly.
    updated.conversation = isConversation ? conversation : current.conversation;
    updated.conversationState = conversationState;
    if (isConversation) forceConversationFields(updated);

    sanitizeContextChain(updated, s.logs);
    if (scheduleChanged) generateJitterForContext(updated);

    s.contexts[idx] = updated;

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
    if (s.activeContextId === id) s.activeContextId = s.contexts[0].id;
    this.sm.persist();
    return true;
  }

  duplicateContext(id: string): TweetContext {
    const source = this.sm.getContext(id);
    if (!source) throw notFound(id);
    return this.createContext({
      name: `${source.name} (Copy)`,
      description: source.description,
      // A removed account falls back to the default (the copy starts paused; pick one before resuming).
      accountId: this.sm.state.accounts.some((a) => a.id === source.accountId)
        ? source.accountId
        : undefined,
      targetTweetId: source.targetTweetId,
      replyTargetMode: source.replyTargetMode || 'original_post',
      engagementMode: source.engagementMode || 'reply',
      autoFallbackToQuote: source.autoFallbackToQuote ?? false,
      lastPostedTweetId: undefined, // Fresh copy starts clean (no chain anchor, no hashtag state)
      enabled: false, // Start paused
      dryRun: source.dryRun,
      schedule: { ...source.schedule },
      template: source.template,
      hashtags: source.hashtags ? [...source.hashtags] : undefined,
      themePreference: source.themePreference,
      hashtagEvolution: source.hashtagEvolution ? { ...source.hashtagEvolution } : undefined,
      mode: source.mode,
      // Fresh state: createContext starts a new run for the copy.
      conversation: source.conversation
        ? {
            ...source.conversation,
            participants: source.conversation.participants.map((p) => ({ ...p })),
          }
        : undefined,
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
    current.chainAnchor = undefined;
    this.queue.clearAndRegenerateQueue(id);
    this.sm.persist();
    return current;
  }

  /** Drops the chain anchor only (no queue regeneration); the next reply targets the root post. */
  clearContextAnchor(id: string): TweetContext {
    const current = this.sm.getContext(id);
    if (!current) throw notFound(id);
    current.lastPostedTweetId = undefined;
    current.chainAnchor = undefined;
    this.sm.persist();
    return current;
  }

  /**
   * Advances a conversation after a turn. Success/simulated: turnCount++, the pre-chosen next speaker
   * takes over, the queue is regenerated, and at `maxTurns` the campaign pauses. Errors change
   * nothing (the same speaker retries). A turn of another run, or not the expected next one, is
   * ignored (`applied: false`), e.g. after a restart while a post was in flight.
   */
  recordConversationTurn(
    id: string,
    turn: { runId: string; turnNumber: number; nextSpeakerAccountId: string },
    status: 'success' | 'simulated' | 'error',
  ): { applied: boolean; autoPausedReason?: string } {
    const ctx = this.sm.getContext(id);
    const state = ctx?.conversationState;
    if (!ctx || ctx.mode !== 'conversation' || !state || status === 'error') {
      return { applied: false };
    }
    if (turn.runId !== state.runId || turn.turnNumber !== state.turnCount + 1) {
      return { applied: false };
    }
    state.turnCount += 1;
    state.nextSpeakerAccountId = turn.nextSpeakerAccountId;
    const max = ctx.conversation?.maxTurns;
    let autoPausedReason: string | undefined;
    if (max && state.turnCount >= max) {
      autoPausedReason = `${FINISHED_PREFIX} (${max} turns)`;
      ctx.enabled = false;
      ctx.autoPausedReason = autoPausedReason;
      console.log(`[Context] ${autoPausedReason}: "${ctx.name}"`);
    }
    this.queue.clearAndRegenerateQueue(id);
    this.sm.persist();
    return { applied: true, autoPausedReason };
  }

  /**
   * New run of a conversation campaign with a new opening post/anchor: turn count and transcript
   * start over (new runId), the chain is reset and a "finished" pause is cleared. `enabled` stays.
   */
  restartConversation(
    id: string,
    input: {
      targetTweetId: string;
      openingPost: string;
      openerHandle?: string;
      firstSpeakerAccountId?: string;
    },
  ): TweetContext {
    const ctx = this.sm.getContext(id);
    if (!ctx) throw notFound(id);
    if (ctx.mode !== 'conversation' || !ctx.conversation) {
      throw new HttpError(400, `"${ctx.name}" is not a conversation campaign.`);
    }
    const targetTweetId = extractTweetId(input.targetTweetId ?? '');
    if (!targetTweetId) throw new HttpError(400, 'targetTweetId must be a tweet ID or a tweet URL');
    const { participants, sharedPrompt, maxTurns } = ctx.conversation;
    const validated = this.validateConversation({
      participants,
      sharedPrompt,
      maxTurns,
      openingPost: input.openingPost,
      openerHandle: input.openerHandle,
      firstSpeakerAccountId: input.firstSpeakerAccountId,
    });
    ctx.targetTweetId = targetTweetId;
    ctx.conversation = validated.config;
    ctx.conversationState = initConversationState(validated.config, validated.handles);
    ctx.lastPostedTweetId = undefined;
    ctx.chainAnchor = undefined;
    if (ctx.autoPausedReason?.startsWith(FINISHED_PREFIX)) ctx.autoPausedReason = undefined;
    ctx.updatedAt = new Date().toISOString();
    this.queue.clearAndRegenerateQueue(id);
    this.sm.persist();
    return ctx;
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

    // The anchor moves only on this campaign's own genuine in-thread reply; errors, simulations,
    // quotes and standalone posts never touch it. Provenance is stored on the campaign itself.
    if (
      postedTweetId &&
      status === 'success' &&
      engagementMode === 'reply' &&
      /^\d+$/.test(postedTweetId)
    ) {
      context.lastPostedTweetId = postedTweetId;
      context.chainAnchor = {
        tweetId: postedTweetId,
        targetTweetId: context.targetTweetId,
        postedAt: new Date().toISOString(),
      };
    }
    generateJitterForContext(context);
    this.sm.persist();
    return { autoPausedReason };
  }

  /**
   * Circuit breaker: immediate on X 401/402 and on an unusable account, otherwise after
   * MAX_CONSECUTIVE_ERRORS in a row.
   */
  private breakerReason(
    context: TweetContext,
    failure?: { errorClass: XErrorClass; message?: string },
  ): string | undefined {
    if (!context.enabled) return undefined;
    if (failure?.errorClass === 'auth') {
      return 'X rejected the credentials (HTTP 401). Verify or reconnect the account, then resume.';
    }
    if (failure?.errorClass === 'account') {
      return (
        failure.message || 'The X account is removed or disconnected — pick an account and resume'
      );
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
