/**
 * Drop service for X ChromaBot.
 * The single code path that composes and posts one drop (template -> X -> telemetry -> log).
 * Used by the scheduler tick, manual post/trigger routes, the webhook and the CLI.
 * It knows nothing about timers; X and Gemini are injected so tests can stub them.
 */

import type { ColorData, PostLog, TweetContext } from '../../shared/types.js';
import { roundFinished } from '../../shared/conversationRound.js';
import { formatTimeInZone, hourInZone, slotTypeForHour } from '../../shared/time.js';
import { checkTweetText } from '../../shared/tweetLength.js';
import { HttpError } from '../middleware/error.js';
import { AgentUnavailableError, resolveTemplateText } from '../templateAgent.js';
import { postColorTweet, type TwitterCredentials } from '../twitterClient.js';
import { classifyXError, type XErrorClass } from '../xErrors.js';
import { DEFAULT_ACCOUNT_ID } from '../../shared/types.js';
import { composeDropText, isEvolutionEnabled, nextHashtagState, usedHashtags } from './dropText.js';
import type { ComposeOptions } from './dropText.js';
import { hashtagService, type HashtagService } from './hashtagService.js';
import {
  buildTurn as globalBuildTurn,
  createConversationService,
  type ConversationTurn,
} from './conversationService.js';
import { services, type Services } from './index.js';
import { generateColor } from '../colorEngine.js';

export interface ExecuteDropOptions {
  contextId?: string;
  slotType?: 'morning' | 'evening' | 'manual';
  color?: ColorData;
  /**
   * Overrides the per-campaign dry-run only. It never overrides the global dry-run switch,
   * which only the owner can turn off (Settings / `globalDryRun`).
   */
  forceLive?: boolean;
  /** Forces a simulation for this call (CLI `--dry-run`); a pure preview, so it ignores global pause. */
  forceDryRun?: boolean;
  /** Exact text to post (e.g. the previewed text); skips template resolution. Still length-checked. */
  text?: string;
  /** Evolved hashtags the previewed `text` used (from the preview response); avoids re-rolling. */
  hashtags?: string[];
  /**
   * Conversation campaigns with `text`: the preview's turn, echoed back so a stale preview is
   * refused (409) instead of posting out of order.
   */
  conversation?: {
    runId: string;
    turnNumber: number;
    speakerAccountId: string;
    nextSpeakerAccountId: string;
  };
  source?: 'scheduler' | 'webhook' | 'manual' | 'cli';
  /** Fixed-time slot this scheduled drop belongs to (lets a transient failure retry that slot). */
  slotKey?: string;
  /** The scheduler tick that started this drop (anchors the campaign clock and live spacing). */
  scheduledAt?: number;
}

export interface DropDeps {
  services: Pick<
    Services,
    'contexts' | 'queue' | 'logs' | 'accounts' | 'rateLimit' | 'settings' | 'flush'
  >;
  postColorTweet: typeof postColorTweet;
  resolveTemplateText: typeof resolveTemplateText;
  /** Evolving-hashtag generator; defaults to the Gemini-with-offline-fallback service. */
  hashtags?: Pick<HashtagService, 'next'>;
  /** Conversation turn composer; defaults to the real one over `services`. */
  buildTurn?: (ctx: TweetContext) => Promise<ConversationTurn>;
}

type TweetResult = Awaited<ReturnType<typeof postColorTweet>>;
type Creds = TwitterCredentials;

export interface DropResult {
  success: boolean;
  result: TweetResult;
  log: PostLog;
  context: TweetContext;
  hashtags?: string[];
}

/** Rate-limit / cooldown responses: set the posting account's cooldown. */
const isCooldown = (r: TweetResult) =>
  !!(
    r.isRateLimitOrCooldown ||
    r.rawResponse?.status === 429 ||
    r.error?.includes('cooldown') ||
    r.error?.includes('not permitted to access this feature')
  );

/** Classifies a failed post by HTTP status and X error body (network/timeouts have no status). */
const classify = (r: TweetResult) =>
  classifyXError(r.httpStatus ?? r.rawResponse?.status, r.rawResponse ?? { detail: r.error });

/**
 * Why the AI could not write a post: busy / timed out / daily cap is transient (retried with
 * back-off, never auto-paused); anything else (not configured, invalid output) is persistent.
 */
const aiFailureClass = (err: unknown): XErrorClass => {
  if (err instanceof AgentUnavailableError) {
    return /not configured/i.test(err.message) ? 'unknown' : 'ai_unavailable';
  }
  // The AI answered, but with nothing usable (empty / not a valid tweet): another try may work.
  if (err instanceof HttpError && err.status === 500 && /not a valid tweet/i.test(err.message)) {
    return 'ai_unavailable';
  }
  return 'unknown';
};

export const createDropService = (deps: DropDeps) => {
  const s = deps.services;
  const hashtags = deps.hashtags ?? hashtagService;
  const buildTurn =
    deps.buildTurn ??
    ((ctx: TweetContext) =>
      s === services
        ? globalBuildTurn(ctx)
        : createConversationService(s as unknown as Services).buildTurn(ctx));

  /** Builds the drop text (template + evolved hashtags); shared by the preview route and posting. */
  const composeText = (context: TweetContext, color: ColorData, options: ComposeOptions = {}) =>
    composeDropText({ resolveTemplateText: deps.resolveTemplateText, hashtags }, context, color, {
      ...options,
      slotLabel: options.slotLabel ?? formatTimeInZone(new Date(), context.schedule?.timezone),
    });

  const describeMode = (
    context: TweetContext,
    mode: string,
    replyTo: string | undefined,
    chainInfo: { isFirstInChain: boolean },
  ) => {
    if (mode === 'reply') {
      const how =
        context.replyTargetMode === 'last_comment'
          ? chainInfo.isFirstInChain
            ? 'Initiating cascade from root'
            : 'Cascading reply to last comment'
          : 'Direct reply to original root';
      return `(Target #${replyTo}, ${how})`;
    }
    if (mode === 'quote') return `(Quoting Post #${context.targetTweetId})`;
    return mode === 'standalone' ? '(Timeline post)' : '';
  };

  /** Retry once on the root post, only when the cascading anchor was deleted (target_missing). */
  const recoverChain = async (
    context: TweetContext,
    first: TweetResult,
    text: string,
    replyTo: string | undefined,
    creds: Creds,
    isDryRun: boolean,
    accountHandle?: string,
  ): Promise<TweetResult> => {
    if (classify(first) !== 'target_missing') {
      console.log(
        `[Drop] Preserving chain anchor #${replyTo} for context "${context.name}" (${classify(first)}: ${first.error}).`,
      );
      return first;
    }
    console.log(
      `[Drop] Cascading anchor #${replyTo} for context "${context.name}" no longer exists (${first.error}). Resetting anchor to primary root post #${context.targetTweetId}.`,
    );
    s.contexts.clearContextAnchor(context.id);
    if (isDryRun) return first;
    const fallback = await deps.postColorTweet(
      creds,
      { text, replyToTweetId: context.targetTweetId, engagementMode: 'reply', accountHandle },
      isDryRun,
    );
    return fallback.success ? fallback : first;
  };

  /** One quote-tweet retry of a reply X refused (cooldown / reply restriction), opt-in per campaign. */
  const quoteFallback = async (
    context: TweetContext,
    first: TweetResult,
    text: string,
    creds: Creds,
    isDryRun: boolean,
    accountHandle?: string,
  ): Promise<TweetResult | undefined> => {
    const errorClass = classify(first);
    if (errorClass !== 'cooldown' && errorClass !== 'reply_restricted') return undefined;
    if (!/^\d+$/.test(context.targetTweetId)) return undefined;
    console.log(
      `[Drop] Reply for context "${context.name}" refused (${errorClass}: ${first.error}). Retrying once as a quote of #${context.targetTweetId}.`,
    );
    const retry = await deps.postColorTweet(
      creds,
      { text, quoteTweetId: context.targetTweetId, engagementMode: 'quote', accountHandle },
      isDryRun,
    );
    return retry.success ? retry : undefined;
  };

  /** Cooldown, live-post spacing and the rate window are per X account (headers are per user). */
  const recordTelemetry = (
    res: TweetResult,
    isDryRun: boolean,
    accountId?: string,
    startedAt?: number,
  ) => {
    if (res.rateLimitHeaders) s.rateLimit.updateRateLimitTelemetry(res.rateLimitHeaders, accountId);
    if (!isDryRun && isCooldown(res)) {
      s.rateLimit.setCooldown(
        15,
        res.error || 'X API Rate Limit / Reply Cooldown Active',
        accountId,
      );
    }
    // Spacing is measured from the start of the drop (its tick), like the campaign clock, so a slow
    // AI call or post does not make the next tick of a 1-minute campaign skip.
    if (!isDryRun && res.success) s.rateLimit.recordLivePostTimestamp(accountId, startedAt);
  };

  /** Campaigns with a drop in progress: one drop per campaign at a time (tick vs. post-now race). */
  const inFlight = new Set<string>();

  /**
   * Crash safety around the one irreversible step. The drop's marker (persisted when it started)
   * is stamped with `sentAt` and flushed right before the request to X; the result (log, anchor,
   * turn, transcript, clock) is saved right after it, in one save. A restart in between leaves a
   * stamped marker, which a later tick turns into an "interrupted" log entry (see
   * ContextService.checkInFlight): at worst the same post is sent once more.
   */
  const sendGuarded = async (
    contextId: string,
    sent: Parameters<Services['contexts']['markSent']>[1],
    send: () => Promise<TweetResult>,
  ): Promise<TweetResult> => {
    s.contexts.markSent(contextId, sent);
    await s.flush();
    return send();
  };

  /** The text must address the next speaker (X only lets an app reply when mentioned). */
  const mentions = (text: string, handle: string) =>
    new RegExp(`(^|[^\\w])[@\uFF20]${handle}\\b`, 'i').test(text);

  /** One conversation turn: the speaker's own account posts, then the shared state advances. */
  const executeConversationDrop = async (
    options: ExecuteDropOptions,
    context: TweetContext,
    source: string,
    startedAt: number,
  ): Promise<DropResult> => {
    const state = context.conversationState;
    if (!context.conversation || !state) {
      throw new HttpError(400, `"${context.name}" has no conversation state.`);
    }
    const maxTurns = context.conversation.maxTurns;
    if (roundFinished(state, maxTurns)) {
      throw new HttpError(
        409,
        `Conversation finished (${maxTurns} turns); resume it for ${maxTurns} more, or restart it.`,
      );
    }
    const isDryRun =
      s.settings.isGlobalDryRun() ||
      !!options.forceDryRun ||
      (options.forceLive ? false : (context.dryRun ?? false));
    const slotType = options.slotType || 'manual';
    // Conversations always cascade: each turn replies to the previous one.
    const chainInfo = s.contexts.getEffectiveReplyTargetId({
      ...context,
      replyTargetMode: 'last_comment',
    });

    let turn: ConversationTurn | undefined;
    let turnError: unknown;
    if (options.text !== undefined) {
      const echo = options.conversation;
      if (!echo) throw new HttpError(400, 'conversation turn details are required with text');
      if (
        echo.runId !== state.runId ||
        echo.turnNumber !== state.turnCount + 1 ||
        echo.speakerAccountId !== state.nextSpeakerAccountId
      ) {
        throw new HttpError(409, 'Conversation moved on, refresh the preview');
      }
      const cast = context.conversation.participants.map((p) => p.accountId);
      if (
        !cast.includes(echo.nextSpeakerAccountId) ||
        echo.nextSpeakerAccountId === echo.speakerAccountId
      ) {
        throw new HttpError(400, 'nextSpeakerAccountId must be another participant');
      }
      const nextHandle = s.accounts.handleOf(echo.nextSpeakerAccountId);
      if (!nextHandle) throw new HttpError(400, 'Verify the next speaker account first');
      if (!mentions(options.text, nextHandle)) {
        throw new HttpError(400, `The reply must mention @${nextHandle} (the next speaker)`);
      }
      turn = {
        runId: state.runId,
        turnNumber: echo.turnNumber,
        speakerAccountId: echo.speakerAccountId,
        speakerHandle: s.accounts.handleOf(echo.speakerAccountId) ?? '',
        nextSpeakerAccountId: echo.nextSpeakerAccountId,
        nextSpeakerHandle: nextHandle,
        text: options.text,
        replyToTweetId: chainInfo.targetTweetId,
        summaryUsed: false,
        transcriptLength: 0,
        ...(options.hashtags ? { hashtags: options.hashtags } : {}),
      };
    } else {
      try {
        turn = await buildTurn(context);
      } catch (err) {
        turnError = err;
      }
    }

    const speakerAccountId = turn?.speakerAccountId ?? state.nextSpeakerAccountId;
    const accountHandle = s.accounts.handleOf(speakerAccountId);
    const accountCreds = s.accounts.getCredentialsForAccount(speakerAccountId);
    const creds: Creds = accountCreds ?? {};
    const accountFailure = !turnError && !isDryRun && !accountCreds;
    const text = turn?.text ?? '';
    if (turn) {
      const check = checkTweetText(text);
      if (!check.ok) {
        throw new HttpError(400, `Tweet text invalid (${check.length}/280 weighted chars)`);
      }
    }

    console.log(
      `[Drop] Executing conversation turn ${turn?.turnNumber ?? state.turnCount + 1} for context ` +
        `"${context.name}" (${context.id}), source: ${source}, ` +
        `mode: ${isDryRun ? 'DRY-RUN' : 'LIVE X'}${s.settings.isGlobalDryRun() ? ' (global dry-run)' : ''}` +
        `, speaker: ${accountHandle ? `@${accountHandle}` : speakerAccountId}`,
    );

    const replyToTweetId = turn?.replyToTweetId;
    let res: TweetResult;
    if (turnError) {
      res = {
        success: false,
        error: turnError instanceof Error ? turnError.message : 'Conversation turn failed',
      };
    } else if (accountFailure) {
      res = {
        success: false,
        error: s.accounts.problem(speakerAccountId) ?? 'X account unavailable',
      };
    } else {
      const send = async () => {
        let r = await deps.postColorTweet(
          creds,
          { text, replyToTweetId, engagementMode: 'reply', accountHandle },
          isDryRun,
        );
        if (!r.success && !chainInfo.isFirstInChain) {
          r = await recoverChain(context, r, text, replyToTweetId, creds, isDryRun, accountHandle);
        }
        return r;
      };
      if (isDryRun) {
        res = await send();
      } else {
        const marker = { runId: state.runId, turn: turn?.turnNumber, replyToTweetId, text };
        res = await sendGuarded(context.id, marker, send);
      }
    }
    // A failed AI turn never reached X, so it must not touch the speaker's X telemetry.
    if (!turnError) recordTelemetry(res, isDryRun, speakerAccountId, startedAt);

    const status = res.success ? (res.simulated ? 'simulated' : 'success') : 'error';
    const errorClass: XErrorClass | undefined = res.success
      ? undefined
      : turnError
        ? aiFailureClass(turnError)
        : accountFailure
          ? 'account'
          : classify(res);
    const failure = errorClass ? { errorClass, message: res.error } : undefined;
    if (errorClass === 'auth' && !isDryRun) s.accounts.markRevoked(speakerAccountId, res.error);
    // Restarted (new run) while this turn was in flight: its tweet belongs to the old thread, so it
    // must not become the new run's chain anchor (nor count toward its breaker).
    const sameRun = s.contexts.getContext(context.id)?.conversationState?.runId === state.runId;
    if (!sameRun) s.contexts.clearInFlight(context.id);
    const posted = sameRun
      ? s.contexts.recordContextPostResult(context.id, status, res.tweetId, 'reply', failure, {
          startedAt,
        })
      : { autoPausedReason: undefined };
    let autoPausedReason = posted.autoPausedReason;
    if (turn && status !== 'error') {
      autoPausedReason =
        s.contexts.recordConversationTurn(context.id, turn, status, res.tweetId).autoPausedReason ??
        autoPausedReason;
    }
    // Evolving hashtags advance only after a posted (live or simulated) turn of this run.
    let usedTags: string[] | undefined;
    if (turn && res.success && sameRun && isEvolutionEnabled(context)) {
      usedTags = usedHashtags(context, text, turn.hashtags);
      const next = nextHashtagState(context, usedTags);
      if (next) s.contexts.setHashtagState(context.id, next);
    }
    const errorMessage =
      autoPausedReason && res.error
        ? `${res.error} [Campaign auto-paused: ${autoPausedReason}]`
        : res.error;
    const logEntry = {
      id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date().toISOString(),
      slotType,
      targetTweetId: context.targetTweetId,
      replyToTweetId: res.replyTo || replyToTweetId,
      engagementMode: 'reply',
      color: generateColor(slotType === 'morning' ? 'morning' : 'evening'),
      tweetText: text,
      tweetId: res.tweetId,
      tweetUrl: res.url,
      status,
      errorMessage,
      contextId: context.id,
      contextName: context.name,
      accountId: speakerAccountId,
      ...(accountHandle ? { accountHandle } : {}),
      conversationRunId: state.runId,
      turn: turn?.turnNumber ?? state.turnCount + 1,
      nextSpeakerAccountId: turn?.nextSpeakerAccountId,
    } as const;
    s.logs.addLog(logEntry);
    // Result, turn, transcript and log reach the store together, right after X answered.
    await s.flush();

    return {
      success: res.success,
      result: res,
      log: logEntry,
      context,
      ...(usedTags ? { hashtags: usedTags } : {}),
    };
  };

  /** Execute a drop for a specific context or the active context. */
  const executeDrop = async (options: ExecuteDropOptions = {}): Promise<DropResult> => {
    const source = options.source || 'manual';
    // Global pause stops every scheduled path; manual posting is still allowed.
    if (source !== 'manual' && !options.forceDryRun && s.settings.isGlobalPaused()) {
      throw new HttpError(409, 'Global pause is on: scheduled drops are stopped');
    }
    const requested = options.contextId ? s.contexts.getContext(options.contextId) : undefined;
    if (options.contextId && !requested) {
      throw new HttpError(404, `Context ${options.contextId} not found`);
    }
    const context: TweetContext = requested || s.contexts.requireActiveContext();
    if (inFlight.has(context.id)) {
      throw new HttpError(409, 'A drop for this campaign is already running');
    }
    // A fresh marker persisted by another process (e.g. an overlapping instance during a deploy).
    if (s.contexts.checkInFlight(context.id, false)) {
      throw new HttpError(409, 'A post for this campaign is still being sent');
    }
    // The campaign clock and the live spacing are anchored to the tick that started the drop.
    const markedAt = Date.now();
    const startedAt = Math.min(options.scheduledAt ?? markedAt, markedAt);
    inFlight.add(context.id);
    try {
      // "Drop in progress" (not yet sent to X): a crash while the AI writes leaves nothing to undo.
      s.contexts.markInFlight(context.id, markedAt);
      await s.flush();
      if (context.mode === 'conversation') {
        return await executeConversationDrop(options, context, source, startedAt);
      }
      return await executeSingleDrop(options, context, source, startedAt);
    } finally {
      inFlight.delete(context.id);
      // Only when the drop ended without recording a result (an exception).
      s.contexts.clearInFlight(context.id, markedAt);
    }
  };

  const executeSingleDrop = async (
    options: ExecuteDropOptions,
    context: TweetContext,
    source: string,
    startedAt: number,
  ): Promise<DropResult> => {
    const isMorning = options.slotType
      ? options.slotType === 'morning'
      : slotTypeForHour(hourInZone(new Date(), context.schedule?.timezone)) === 'morning';
    const slotType = options.slotType || (isMorning ? 'morning' : 'evening');
    const color: ColorData =
      options.color ||
      s.queue.popNextQueueSlot(slotType === 'morning' ? 'morning' : 'evening', context.id);
    let composed: { text: string; hashtags?: string[] };
    let composeError: AgentUnavailableError | undefined;
    try {
      composed =
        options.text !== undefined
          ? { text: options.text, hashtags: options.hashtags }
          : await composeText(context, color);
    } catch (err) {
      // An AI-only template whose AI failed: recorded like any failed post (log, back-off), so a
      // scheduled campaign retries on a schedule instead of on every tick.
      if (!(err instanceof AgentUnavailableError)) throw err;
      composeError = err;
      composed = { text: '' };
    }
    const text = composed.text;
    const textCheck = checkTweetText(text);
    if (!composeError && !textCheck.ok) {
      throw new HttpError(400, `Tweet text invalid (${textCheck.length}/280 weighted chars)`);
    }

    const engagementMode = context.engagementMode || 'reply';
    const chainInfo = s.contexts.getEffectiveReplyTargetId(context);
    const replyToTweetId = engagementMode === 'reply' ? chainInfo.targetTweetId : undefined;
    const quoteTweetId = engagementMode === 'quote' ? context.targetTweetId : undefined;
    const isDryRun =
      s.settings.isGlobalDryRun() ||
      !!options.forceDryRun ||
      (options.forceLive ? false : (context.dryRun ?? false));
    // The campaign's own X account signs every request of this drop (default: the env account).
    const accountId = context.accountId || undefined;
    const accountHandle = s.accounts.handleOf(accountId);
    const accountCreds = s.accounts.getCredentialsForAccount(accountId);
    // A simulation never reaches X, so it does not need usable account tokens.
    const creds: Creds = accountCreds ?? {};
    const accountFailure = !isDryRun && !accountCreds;

    console.log(
      `[Drop] Executing drop for context "${context.name}" (${context.id}) ` +
        `-> Mode: ${engagementMode.toUpperCase()} ` +
        `${describeMode(context, engagementMode, replyToTweetId, chainInfo)}` +
        `, source: ${source}, mode: ${isDryRun ? 'DRY-RUN' : 'LIVE X'}${s.settings.isGlobalDryRun() ? ' (global dry-run)' : ''}` +
        `, account: ${accountHandle ? `@${accountHandle}` : (accountId ?? DEFAULT_ACCOUNT_ID)}`,
    );

    let fallbackTriggered = false;
    const send = async (): Promise<TweetResult> => {
      let r = await deps.postColorTweet(
        creds,
        { text, replyToTweetId, quoteTweetId, engagementMode, accountHandle },
        isDryRun,
      );
      if (
        !r.success &&
        engagementMode === 'reply' &&
        context.replyTargetMode === 'last_comment' &&
        !chainInfo.isFirstInChain
      ) {
        r = await recoverChain(context, r, text, replyToTweetId, creds, isDryRun, accountHandle);
      }
      if (!r.success && engagementMode === 'reply' && context.autoFallbackToQuote) {
        const quoted = await quoteFallback(context, r, text, creds, isDryRun, accountHandle);
        if (quoted) {
          r = quoted;
          fallbackTriggered = true;
        }
      }
      return r;
    };
    // An unusable account fails the drop without calling X (and pauses the campaign at once).
    let res: TweetResult;
    if (composeError) {
      res = { success: false, error: composeError.message };
    } else if (accountFailure) {
      res = { success: false, error: s.accounts.problem(accountId) ?? 'X account unavailable' };
    } else if (isDryRun) {
      res = await send();
    } else {
      res = await sendGuarded(context.id, { replyToTweetId, text }, send);
    }
    if (!composeError) recordTelemetry(res, isDryRun, accountId, startedAt);
    const finalMode = fallbackTriggered ? 'quote' : engagementMode;

    const status = res.success ? (res.simulated ? 'simulated' : 'success') : 'error';
    const errorClass: XErrorClass | undefined = res.success
      ? undefined
      : composeError
        ? aiFailureClass(composeError)
        : accountFailure
          ? 'account'
          : classify(res);
    const failure = errorClass ? { errorClass, message: res.error } : undefined;
    // X rejected this account's tokens: mark it revoked so the UI and other campaigns know.
    if (errorClass === 'auth' && !isDryRun) s.accounts.markRevoked(accountId, res.error);
    const { autoPausedReason } = s.contexts.recordContextPostResult(
      context.id,
      status,
      res.tweetId,
      res.engagementMode || finalMode,
      failure,
      { startedAt, slotKey: options.slotKey },
    );
    // The campaign's own series history for `<history>` prompts (never trimmed by other campaigns).
    if (status === 'success') {
      s.contexts.rememberPost(context.id, {
        text,
        ...(res.tweetId ? { tweetId: res.tweetId } : {}),
        at: new Date().toISOString(),
        slotType,
        colorName: color.name,
        colorHex: color.hex,
      });
    }
    const errorMessage =
      autoPausedReason && res.error
        ? `${res.error} [Campaign auto-paused: ${autoPausedReason}]`
        : res.error;
    const logEntry = {
      id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date().toISOString(),
      slotType,
      targetTweetId: context.targetTweetId,
      replyToTweetId: fallbackTriggered ? undefined : res.replyTo || replyToTweetId,
      quoteTweetId: res.quoteTweetId || (fallbackTriggered ? context.targetTweetId : quoteTweetId),
      engagementMode: res.engagementMode || finalMode,
      ...(fallbackTriggered ? { fallbackTriggered: true } : {}),
      color,
      tweetText: text,
      tweetId: res.tweetId,
      tweetUrl: res.url,
      status,
      errorMessage,
      contextId: context.id,
      contextName: context.name,
      accountId: accountId ?? DEFAULT_ACCOUNT_ID,
      ...(accountHandle ? { accountHandle } : {}),
    } as const;
    s.logs.addLog(logEntry);

    // Evolving hashtags advance only after a posted (live or simulated) drop, never on failure.
    let usedTags: string[] | undefined;
    if (isEvolutionEnabled(context)) {
      usedTags = usedHashtags(context, text, composed.hashtags);
      const next = res.success ? nextHashtagState(context, usedTags) : undefined;
      if (next) s.contexts.setHashtagState(context.id, next);
    }
    // Result, anchor, history and log reach the store together, right after X answered.
    await s.flush();

    return {
      success: res.success,
      result: res,
      log: logEntry,
      context,
      ...(usedTags ? { hashtags: usedTags } : {}),
    };
  };

  /** True while this process is sending a drop for the campaign. */
  const isRunning = (contextId: string) => inFlight.has(contextId);

  return { executeDrop, composeText, buildTurn, isRunning };
};

export type DropService = ReturnType<typeof createDropService>;

export const dropService: DropService = createDropService({
  services,
  postColorTweet,
  resolveTemplateText,
});
