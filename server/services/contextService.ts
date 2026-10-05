/**
 * Tweet context (campaign) domain logic: CRUD, active context, chain anchors and post results.
 */

import { DEFAULT_TWEET_TEMPLATE, generateColor } from '../colorEngine.js';
import { roundFinished } from '../../shared/conversationRound.js';
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
  InFlightPost,
  PendingFire,
  PostLog,
  RecentPost,
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
import { isTransientFailure, transientReason, type XErrorClass } from '../xErrors.js';
import { getXTimeoutMs } from '../timeouts.js';
import { appendTurnRecord, clipStoredText, turnBufferOf } from './conversationTurn.js';
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

/** Back-off after a persistent error (and the cap of the transient back-off). */
const MAX_RETRY_DELAY_MS = 15 * 60 * 1000;
const MIN_RETRY_DELAY_MS = 60 * 1000;
/** Successful live posts kept per single-mode campaign for `<history>` prompts. */
export const RECENT_POSTS_MAX = 10;
/**
 * A sent-to-X marker older than this belongs to a crashed/killed process and is cleared:
 * 3 X timeouts (a drop makes at most 3 X requests: post, chain recovery, quote fallback), >= 90 s.
 */
export const staleInFlightMs = (): number => Math.max(3 * getXTimeoutMs(), 90_000);
/** Identifies this process in in-flight markers. */
export const BOOT_ID = `boot_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

/**
 * Delay before retrying after a transient failure: 1x, 2x, 4x... the campaign interval, at least
 * one minute and at most 15 minutes (fixed-time campaigns use a 1-minute base).
 */
export const transientRetryDelayMs = (intervalMinutes: number, attempt: number): number => {
  const base = Math.max(MIN_RETRY_DELAY_MS, intervalMinutes * 60 * 1000);
  const factor = 2 ** Math.min(Math.max(attempt - 1, 0), 16);
  return Math.min(MAX_RETRY_DELAY_MS, base * factor);
};

/** Opening line of the auto-pause reason when a conversation reached its turn limit. */
const FINISHED_PREFIX = 'Conversation finished';

/** Fields a conversation campaign always has (the speaker changes per turn; no quotes). */
const forceConversationFields = (ctx: TweetContext) => {
  ctx.engagementMode = 'reply';
  ctx.replyTargetMode = 'last_comment';
  ctx.autoFallbackToQuote = false;
};

const recentPostFromLog = (l: PostLog): RecentPost => ({
  text: clipStoredText(l.tweetText),
  ...(l.tweetId ? { tweetId: l.tweetId } : {}),
  at: l.timestamp,
  slotType: l.slotType,
  ...(l.color?.name ? { colorName: l.color.name } : {}),
  ...(l.color?.hex ? { colorHex: l.color.hex } : {}),
});

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

  /**
   * Boot-time: creates the primary context on first run only (a store the owner emptied stays
   * empty) and repairs polluted chains.
   */
  ensureDefaultContext() {
    const s = this.sm.state;
    if (s.contexts.length === 0) {
      if (s.campaignsSeeded) {
        s.activeContextId = '';
        return;
      }
      const primary = buildPrimaryContext(s);
      s.contexts.push(primary);
      s.activeContextId = primary.id;
      s.campaignsSeeded = true;
      this.sm.persist();
      return;
    }

    if (!s.contexts.some((c) => c.id === s.activeContextId)) {
      s.activeContextId = s.contexts[0].id;
    }
    let modified = false;
    if (!s.campaignsSeeded) {
      s.campaignsSeeded = true;
      modified = true;
    }
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

  /** Undefined only when there are no campaigns. */
  getActiveContext(): TweetContext | undefined {
    return this.sm.getActiveContext();
  }

  /** The active campaign, or a 404 when there are none (paths that need one to act on). */
  requireActiveContext(): TweetContext {
    const active = this.getActiveContext();
    if (!active) throw new HttpError(404, 'There are no campaigns: create one first.');
    return active;
  }

  setActiveContextId(id: string): TweetContext | undefined {
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
    // Without explicit hashtags the template's literal tags become the campaign's hashtags (a
    // conversation never uses the template, so it starts without any).
    const isConversation = data.mode === 'conversation';
    const template = data.template?.trim() || DEFAULT_TWEET_TEMPLATE;
    const tagged =
      data.hashtags !== undefined
        ? { template, hashtags: normaliseCampaignTags(data.hashtags) }
        : isConversation
          ? { template, hashtags: [] }
          : extractTemplateHashtags(template);
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
      scheduleStartedAt: Date.now(),
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
      // Before turn 1 nothing has happened yet, so a new first speaker/opening post takes effect.
      if (validated && (!kept || targetChanged || modeChanged || kept.turnCount === 0)) {
        conversationState = initConversationState(conversation, validated.handles);
      } else if (!kept) {
        conversationState = initConversationState(
          conversation,
          this.validateConversation(conversation).handles,
        );
      } else if (
        !conversation.participants.some((p) => p.accountId === kept.nextSpeakerAccountId)
      ) {
        // Never the account that spoke last (no one replies to themselves).
        const lastSpeaker =
          kept.turns?.[kept.turns.length - 1]?.accountId ||
          s.logs.find(
            (l) =>
              l.contextId === id &&
              l.conversationRunId === kept.runId &&
              (l.status === 'success' || l.status === 'simulated'),
          )?.accountId;
        conversationState = {
          ...kept,
          nextSpeakerAccountId: repickNextSpeaker(conversation, lastSpeaker),
        };
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
    // A change of what or where the campaign posts makes an old failure meaningless: drop the
    // retry back-off and the breaker streak so the next due tick posts with the new setup.
    const setupChanged =
      targetChanged ||
      accountChanged ||
      modeChanged ||
      (updates.template !== undefined && updates.template !== current.template) ||
      (updates.conversation !== undefined &&
        JSON.stringify([updates.conversation.participants, updates.conversation.sharedPrompt]) !==
          JSON.stringify([
            current.conversation?.participants,
            current.conversation?.sharedPrompt,
          ])) ||
      !!resetChain;
    // A conversation can resume only when every participant is usable.
    const blocked = !resumed
      ? undefined
      : isConversation
        ? conversation?.participants
            .map((p) => accountProblem(this.sm.state, p.accountId))
            .find(Boolean)
        : accountProblem(this.sm.state, accountId);
    if (blocked) throw new HttpError(400, `Cannot resume "${current.name}": ${blocked}.`);
    const finishedAt = conversation?.maxTurns;
    let finished = isConversation && roundFinished(conversationState, finishedAt);
    if (resumed && finished && conversationState) {
      // Resuming a finished conversation starts a new round of maxTurns in the same thread.
      conversationState = { ...conversationState, roundStartTurn: conversationState.turnCount };
      finished = false;
    }

    // The chain anchor is server-owned: only a target change, an account change (another account's
    // replies are a different thread) or an explicit reset moves it. A client-sent
    // `lastPostedTweetId` (e.g. the edit form echoing a stale value) is ignored.
    const keepChain = !targetChanged && !modeChanged && !accountChanged && !resetChain;
    const updated: TweetContext = {
      ...current,
      ...fields,
      // Re-enabling restarts the interval from now and clears any circuit-breaker state.
      ...(resumed
        ? {
            lastPostedTimestamp: Date.now(),
            consecutiveErrors: 0,
            autoPausedReason: undefined,
            retry: undefined,
            scheduleStartedAt: Date.now(),
          }
        : {}),
      ...(setupChanged && !resumed ? { consecutiveErrors: 0, retry: undefined } : {}),
      ...(scheduleChanged && !resumed ? { scheduleStartedAt: Date.now() } : {}),
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
    // A lowered turn limit that is already reached finishes the conversation now.
    if (finished && updated.enabled) {
      updated.enabled = false;
      updated.autoPausedReason = `${FINISHED_PREFIX} (${finishedAt} turns)`;
    }

    sanitizeContextChain(updated, s.logs);
    if (scheduleChanged) generateJitterForContext(updated);

    s.contexts[idx] = updated;

    // Any save/edit of a campaign clears its queue and regenerates based on the new settings
    this.queue.clearAndRegenerateQueue(id);
    this.sm.persist();
    return updated;
  }

  /**
   * Starts the interval clock from `at` (legacy contexts stored with 0); no queue regeneration.
   * An explicit clock replaces any pending retry.
   */
  setContextLastPostedTimestamp(contextId: string, at: number) {
    const ctx = this.sm.getContext(contextId);
    if (!ctx) return;
    ctx.lastPostedTimestamp = at;
    ctx.retry = undefined;
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
    const idx = s.contexts.findIndex((c) => c.id === id);
    if (idx === -1) return false;

    // Deleting the last campaign is allowed: the store stays empty (see `ensureDefaultContext`).
    s.contexts.splice(idx, 1);
    s.queue = s.queue.filter((q) => q.contextId !== id);
    if (s.activeContextId === id) s.activeContextId = s.contexts[0]?.id ?? '';
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
    turn: {
      runId: string;
      turnNumber: number;
      nextSpeakerAccountId: string;
      speakerAccountId?: string;
      speakerHandle?: string;
      text?: string;
    },
    status: 'success' | 'simulated' | 'error',
    tweetId?: string,
  ): { applied: boolean; autoPausedReason?: string } {
    const ctx = this.sm.getContext(id);
    const state = ctx?.conversationState;
    if (!ctx || ctx.mode !== 'conversation' || !state || status === 'error') {
      return { applied: false };
    }
    if (turn.runId !== state.runId || turn.turnNumber !== state.turnCount + 1) {
      return { applied: false };
    }
    // Legacy state: seed the buffer from whatever the log still has, then keep it on the campaign.
    if (!state.turns) state.turns = turnBufferOf(state, () => this.sm.state.logs, id);
    appendTurnRecord(state, {
      turn: turn.turnNumber,
      accountId: turn.speakerAccountId ?? '',
      handle: turn.speakerHandle || 'unknown',
      text: turn.text ?? '',
      ...(tweetId && status === 'success' ? { tweetId } : {}),
      at: new Date().toISOString(),
    });
    state.turnCount += 1;
    state.nextSpeakerAccountId = turn.nextSpeakerAccountId;
    const max = ctx.conversation?.maxTurns;
    let autoPausedReason: string | undefined;
    if (roundFinished(state, max)) {
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
    // Same limits as the campaign schema (the restart route takes a plain body).
    if ((input.openingPost ?? '').length > 1000) {
      throw new HttpError(400, 'openingPost must be at most 1000 characters');
    }
    const opener = input.openerHandle?.trim().replace(/^@/, '');
    if (opener && !/^[A-Za-z0-9_]{1,15}$/.test(opener)) {
      throw new HttpError(400, 'openerHandle must be an X handle (letters, digits, _; up to 15)');
    }
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
    // A new run starts clean: no back-off or breaker streak from the old thread.
    ctx.retry = undefined;
    ctx.consecutiveErrors = 0;
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

  /**
   * Records one post attempt on the campaign (stats, breaker, retry back-off, chain anchor) and
   * clears its in-flight marker. Called in the same synchronous step as the log append, so a save
   * always carries both.
   *
   * Failures are split in two (see `isTransientFailure`):
   *  - transient (AI unavailable, X 5xx, network/timeout): exponential back-off from the interval
   *    (1x, 2x, 4x..., 1-15 min) and never an auto-pause; `consecutiveErrors` is left alone;
   *  - persistent (everything else): a 15-minute back-off and the circuit breaker after
   *    MAX_CONSECUTIVE_ERRORS. X throttling (429 / reply cooldown) keeps its own account cooldown
   *    and never counts toward the breaker.
   * A success (live or simulated) clears the streak and the retry.
   */
  recordContextPostResult(
    contextId: string,
    status: 'success' | 'simulated' | 'error',
    postedTweetId?: string,
    engagementMode: 'reply' | 'quote' | 'standalone' = 'reply',
    failure?: { errorClass: XErrorClass; message?: string },
    options: { startedAt?: number; slotKey?: string } = {},
  ): { autoPausedReason?: string } {
    const context = this.sm.getContext(contextId);
    if (!context) return {};
    let autoPausedReason: string | undefined;
    const now = Date.now();
    // The cadence is anchored to when the drop started, not when X answered: a slow AI call or
    // post must not push a 1-minute campaign past the next scheduler tick.
    const startedAt = Math.min(options.startedAt ?? now, now);
    context.inFlight = undefined;

    if (!context.stats) {
      context.stats = { totalPosts: 0, successfulPosts: 0, simulatedPosts: 0, failedPosts: 0 };
    }
    context.stats.totalPosts += 1;
    if (status === 'success') context.stats.successfulPosts += 1;
    if (status === 'simulated') context.stats.simulatedPosts += 1;
    if (status === 'error') {
      context.stats.failedPosts += 1;
      const intervalMinutes =
        context.schedule.mode === 'interval' ? context.schedule.intervalMinutes || 60 : 1;
      if (failure && isTransientFailure(failure.errorClass)) {
        const prev = context.retry?.transient ? context.retry : undefined;
        const attempt = (prev?.attempt ?? 0) + 1;
        const slotKey = options.slotKey ?? prev?.slotKey;
        // A fixed-time campaign retries only a scheduled slot (a failed manual post just fails).
        context.retry =
          context.schedule.mode === 'interval' || slotKey
            ? {
                at: now + transientRetryDelayMs(intervalMinutes, attempt),
                reason: transientReason(failure.errorClass),
                transient: true,
                attempt,
                ...(slotKey
                  ? { slotKey, since: prev?.slotKey === slotKey ? (prev.since ?? now) : now }
                  : {}),
              }
            : undefined;
      } else {
        // Throttling (429 / reply cooldown) is handled by the account cooldown, not the breaker.
        const throttled =
          failure?.errorClass === 'rate_limit' || failure?.errorClass === 'cooldown';
        if (!throttled) context.consecutiveErrors = (context.consecutiveErrors || 0) + 1;
        autoPausedReason = this.breakerReason(context, failure);
        if (autoPausedReason) {
          context.enabled = false;
          context.autoPausedReason = autoPausedReason;
          console.warn(`[Context] Auto-paused "${context.name}": ${autoPausedReason}`);
        }
        // Safety anti-hammer backoff: at least 15 minutes (or one interval, when longer) so an X
        // reply cooldown has time to clear. Fixed-time campaigns simply wait for their next slot.
        context.retry =
          context.schedule.mode === 'interval'
            ? {
                at: now + Math.max(MAX_RETRY_DELAY_MS, intervalMinutes * 60 * 1000),
                reason: throttled ? 'X throttled the account' : 'last post failed',
                transient: false,
                attempt: 0,
              }
            : undefined;
      }
      context.lastPostedTimestamp = startedAt;
    } else {
      context.consecutiveErrors = 0;
      context.retry = undefined;
      context.lastPostedTimestamp = startedAt;
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

  /** Remembers a successful live single-mode post for `<history>` prompts (last 10, on the campaign). */
  rememberPost(contextId: string, post: RecentPost) {
    const ctx = this.sm.getContext(contextId);
    if (!ctx) return;
    const posts = ctx.recentPosts ?? this.recentPostsFromLogs(contextId);
    ctx.recentPosts = [...posts, { ...post, text: clipStoredText(post.text) }].slice(
      -RECENT_POSTS_MAX,
    );
    this.sm.persist();
  }

  /**
   * The campaign's series history (oldest first). Legacy campaigns without `recentPosts` are seeded
   * once from whatever successful posts the shared, capped log still has.
   */
  getRecentPosts(contextId: string): RecentPost[] | undefined {
    const ctx = this.sm.getContext(contextId);
    if (!ctx) return undefined;
    if (!ctx.recentPosts) {
      ctx.recentPosts = this.recentPostsFromLogs(contextId);
      this.sm.persist();
    }
    return ctx.recentPosts;
  }

  private recentPostsFromLogs(contextId: string): RecentPost[] {
    return this.sm.state.logs
      .filter((l) => l.contextId === contextId && l.status === 'success')
      .slice(-RECENT_POSTS_MAX)
      .map((l) => recentPostFromLog(l));
  }

  /** Drops a pending retry (obsolete fixed-slot retry); the normal schedule applies again. */
  clearRetry(contextId: string) {
    const ctx = this.sm.getContext(contextId);
    if (!ctx?.retry) return;
    ctx.retry = undefined;
    this.sm.persist();
  }

  /**
   * Persists the "drop in progress" marker at the start of a drop (cleared by
   * `recordContextPostResult`); `markSent` stamps it right before the request to X.
   */
  markInFlight(contextId: string, startedAt = Date.now()) {
    const ctx = this.sm.getContext(contextId);
    if (!ctx) return;
    ctx.inFlight = { startedAt, bootId: BOOT_ID };
    this.sm.persist();
  }

  /** Stamps the marker with what is about to be sent to X, and when. */
  markSent(
    contextId: string,
    sent: Pick<InFlightPost, 'runId' | 'turn' | 'replyToTweetId' | 'text'>,
  ) {
    const ctx = this.sm.getContext(contextId);
    if (!ctx) return;
    ctx.inFlight = {
      ...(ctx.inFlight ?? { startedAt: Date.now(), bootId: BOOT_ID }),
      ...sent,
      sentAt: Date.now(),
    };
    this.sm.persist();
  }

  /** Drops this drop's marker without recording a result (it ended before a result was recorded). */
  clearInFlight(contextId: string, startedAt?: number) {
    const ctx = this.sm.getContext(contextId);
    if (!ctx?.inFlight) return;
    if (startedAt !== undefined && ctx.inFlight.startedAt !== startedAt) return;
    ctx.inFlight = undefined;
    this.sm.persist();
  }

  /**
   * True while another process may still be posting this campaign (a fresh sent-to-X marker it
   * wrote). Otherwise a leftover marker is cleared and the campaign continues:
   *  - never sent to X (no `sentAt`: the drop died while the AI was writing): cleared silently;
   *  - sent, but the result was never recorded (stale, or left by this process): an "interrupted"
   *    log entry keeps the history honest and the same turn/post is attempted again
   *    (see docs/campaign-isolation.md §7).
   */
  checkInFlight(contextId: string, isOwnDropRunning: boolean, now = Date.now()): boolean {
    const ctx = this.sm.getContext(contextId);
    const marker = ctx?.inFlight;
    if (!ctx || !marker) return false;
    if (isOwnDropRunning) return true;
    if (marker.sentAt === undefined) {
      ctx.inFlight = undefined;
      this.sm.persist();
      return false;
    }
    if (marker.bootId !== BOOT_ID && now - marker.sentAt < staleInFlightMs()) return true;
    ctx.inFlight = undefined;
    const log: PostLog = {
      id: `log_${now}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date(now).toISOString(),
      slotType: 'manual',
      targetTweetId: ctx.targetTweetId,
      replyToTweetId: marker.replyToTweetId,
      color: generateColor('morning'),
      tweetText: marker.text ?? '',
      status: 'error',
      errorMessage:
        'Interrupted (restart while posting): the result was not recorded. If X accepted it, the ' +
        'same post may appear twice; the campaign continues from its last recorded post.',
      contextId: ctx.id,
      contextName: ctx.name,
      ...(marker.runId ? { conversationRunId: marker.runId, turn: marker.turn } : {}),
    };
    const logs = this.sm.state.logs;
    logs.push(log);
    console.warn(`[Context] Cleared an interrupted post of "${ctx.name}" (sent ${marker.sentAt}).`);
    this.sm.persist();
    return false;
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
