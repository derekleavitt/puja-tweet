/**
 * Conversation campaigns: composes one turn (speaker, next speaker, text, reply target).
 * Pure helpers live in `conversationTurn.ts`; spec in docs/design/conversations.md.
 */

import { HttpError } from '../middleware/error.js';
import { generateAgentText } from '../templateAgent.js';
import { services } from './index.js';
import { checkTweetText } from '../../shared/tweetLength.js';
import type { PostLog, TweetContext } from '../../shared/types.js';
import {
  RECENT_TURNS,
  SUMMARY_MAX_LENGTH,
  buildConversationPrompt,
  buildSummaryPrompt,
  buildTranscript,
  conversationBudget,
  deMentionStrangers,
  ensureMention,
  pickNext,
  shouldSummarize,
  type TranscriptTurn,
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

  /** Best effort: folds old turns into the summary; a failure keeps the old one. */
  const refreshSummary = async (ctx: TweetContext, transcript: TranscriptTurn[]): Promise<void> => {
    const state = ctx.conversationState;
    if (!state || !shouldSummarize(state)) return;
    const through = state.turnCount - RECENT_TURNS;
    const old = state.summaryThroughTurn ?? 0;
    const fold = transcript.filter((t) => t.turn > old && t.turn <= through);
    if (!fold.length) return;
    try {
      const prompt = buildSummaryPrompt(state.summary, fold);
      const summary = await generate(prompt.contents, {
        systemInstruction: prompt.systemInstruction,
        maxLength: SUMMARY_MAX_LENGTH,
        temperature: 0.4,
      });
      // Mutate the live state (persisted with the next recorded turn); skip a restarted run.
      const live = deps.contexts.getContext(ctx.id)?.conversationState;
      for (const s of new Set([state, live])) {
        if (s && s.runId === state.runId) {
          s.summary = summary;
          s.summaryThroughTurn = through;
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

    const transcript = buildTranscript(deps.logs.getLogs(), ctx.id, state.runId);
    await refreshSummary(ctx, transcript);
    const recent = transcript.filter((t) => t.turn > state.turnCount - RECENT_TURNS);

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
      transcriptLength: transcript.length,
    };
  };

  return { buildTurn };
};

/** Convenience over the global `services` singleton (like templateAgent). */
export const buildTurn = (ctx: TweetContext): Promise<ConversationTurn> =>
  createConversationService(services).buildTurn(ctx);
