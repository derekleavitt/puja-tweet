/**
 * Conversation campaigns: composes one turn (speaker, next speaker, text, reply target).
 * Pure helpers live in `conversationTurn.ts`; spec in docs/design/conversations.md.
 */

import { HttpError } from '../middleware/error.js';
import { generateAgentText } from '../templateAgent.js';
import { services } from './index.js';
import { checkTweetText } from '../../shared/tweetLength.js';
import type { ConversationTurnRecord, PostLog, TweetContext } from '../../shared/types.js';
import {
  RECENT_TURNS,
  SUMMARY_MAX_LENGTH,
  buildConversationPrompt,
  buildSummaryPrompt,
  conversationBudget,
  deMentionStrangers,
  ensureMention,
  pickNext,
  shouldSummarize,
  turnBufferOf,
  unsummarizedTurns,
} from './conversationTurn.js';

export interface ConversationTurn {
  runId: string;
  turnNumber: number;
  speakerAccountId: string;
  speakerHandle: string;
  nextSpeakerAccountId: string;
  nextSpeakerHandle: string;
  text: string;
  replyToTweetId: string;
  summaryUsed: boolean;
  transcriptLength: number;
}

export interface ConversationServiceDeps {
  accounts: { handleOf(id?: string | null): string | undefined };
  contexts: {
    getContext(id: string): TweetContext | undefined;
    getEffectiveReplyTargetId(ctx: TweetContext): { targetTweetId: string };
  };
  logs: { getLogs(): PostLog[] };
  generate?: typeof generateAgentText;
  rng?: () => number;
}

const needHandle = (handle: string | undefined, accountId: string): string => {
  if (!handle) {
    throw new HttpError(400, `Verify @handle first: account "${accountId}" has no known handle.`);
  }
  return handle;
};

export const createConversationService = (deps: ConversationServiceDeps) => {
  const generate = deps.generate ?? generateAgentText;

  /**
   * Best effort: folds the oldest buffered turns into the summary (keeping the last RECENT_TURNS
   * verbatim) and drops them from the buffer in the same step, so the summary always covers every
   * turn that is no longer buffered. A failure keeps both the old summary and the buffer.
   */
  const refreshSummary = async (ctx: TweetContext, turns: ConversationTurnRecord[]) => {
    const state = ctx.conversationState;
    if (!state || !shouldSummarize(state)) return;
    const through = state.turnCount - RECENT_TURNS;
    const old = state.summaryThroughTurn ?? 0;
    const fold = turns.filter((t) => t.turn > old && t.turn <= through);
    if (!fold.length) return;
    try {
      const prompt = buildSummaryPrompt(state.summary, fold);
      const summary = await generate(prompt.contents, {
        systemInstruction: prompt.systemInstruction,
        maxLength: SUMMARY_MAX_LENGTH,
        temperature: 0.4,
      });
      // Mutate the live state (persisted with the next save); skip a restarted run.
      const live = deps.contexts.getContext(ctx.id)?.conversationState;
      for (const s of new Set([state, live])) {
        // Another summary may have landed meanwhile (a concurrent preview): never move backwards.
        if (s && s.runId === state.runId && (s.summaryThroughTurn ?? 0) === old) {
          s.summary = summary;
          s.summaryThroughTurn = through;
          s.turns = (s.turns ?? turns).filter((t) => t.turn > through);
        }
      }
    } catch (err) {
      console.warn('[Conversation] Summary refresh failed, keeping the old one:', err);
    }
  };

  const buildTurn = async (ctx: TweetContext): Promise<ConversationTurn> => {
    const config = ctx.conversation;
    const state = ctx.conversationState;
    if (ctx.mode !== 'conversation' || !config || !state) {
      throw new HttpError(400, `"${ctx.name}" is not a conversation campaign.`);
    }
    const ids = config.participants.map((p) => p.accountId);
    const handleOf = (id: string) => needHandle(deps.accounts.handleOf(id), id);
    const speakerAccountId = state.nextSpeakerAccountId;
    const speaker = config.participants.find((p) => p.accountId === speakerAccountId);
    if (!speaker) {
      throw new HttpError(400, 'The next speaker is no longer part of the conversation.');
    }
    const speakerHandle = handleOf(speakerAccountId);
    const nextSpeakerAccountId = pickNext(speakerAccountId, ids, deps.rng);
    const nextSpeakerHandle = handleOf(nextSpeakerAccountId);
    const handles = ids.map(handleOf);

    // The campaign's own buffer, never the shared capped log (legacy state is seeded from it once).
    if (!state.turns) state.turns = turnBufferOf(state, () => deps.logs.getLogs(), ctx.id);
    await refreshSummary(ctx, state.turns);
    // Every turn the summary does not cover (normally 15-20), so nothing falls in between.
    const recent = unsummarizedTurns(state, state.turns ?? []);

    const max = conversationBudget(nextSpeakerHandle);
    const prompt = buildConversationPrompt({
      sharedPrompt: config.sharedPrompt,
      persona: speaker.persona,
      speakerHandle,
      otherHandles: handles.filter((h) => h !== speakerHandle),
      openerHandle: config.openerHandle,
      openingPost: config.openingPost,
      summary: state.summary,
      summaryThroughTurn: state.summaryThroughTurn,
      transcript: recent,
      turnNumber: state.turnCount + 1,
      nextHandle: nextSpeakerHandle,
      max,
    });
    const raw = await generate(prompt.contents, {
      systemInstruction: prompt.systemInstruction,
      maxLength: max,
    });
    const allowed = config.openerHandle ? [...handles, config.openerHandle] : handles;
    const text = ensureMention(deMentionStrangers(raw, allowed), nextSpeakerHandle, max);
    if (!checkTweetText(text).ok) {
      throw new HttpError(500, 'The generated conversation turn is not a valid tweet.');
    }

    const { targetTweetId } = deps.contexts.getEffectiveReplyTargetId({
      ...ctx,
      replyTargetMode: 'last_comment',
    });
    return {
      runId: state.runId,
      turnNumber: state.turnCount + 1,
      speakerAccountId,
      speakerHandle,
      nextSpeakerAccountId,
      nextSpeakerHandle,
      text,
      replyToTweetId: targetTweetId,
      summaryUsed: !!state.summary,
      transcriptLength: recent.length,
    };
  };

  return { buildTurn };
};

/** Convenience over the global `services` singleton (like templateAgent). */
export const buildTurn = (ctx: TweetContext): Promise<ConversationTurn> =>
  createConversationService(services).buildTurn(ctx);
