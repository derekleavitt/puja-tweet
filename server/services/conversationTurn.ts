/**
 * Conversation campaigns: the pure parts of writing one turn (speaker choice, mention rules,
 * transcript, Gemini prompts). No I/O; `conversationService.ts` wires them to the services.
 * Spec: docs/design/conversations.md (sections 2 and 3).
 */

import { trimToCompleteSentence, weightedTweetLength } from '../../shared/tweetLength.js';
import type { ConversationState, ConversationTurnRecord, PostLog } from '../../shared/types.js';
import { mentionsHandle } from './conversationConfig.js';

/** Turns always sent word for word. */
export const RECENT_TURNS = 15;
/** Un-summarised turns beyond this many trigger a summary refresh. */
export const SUMMARY_TRIGGER_TURNS = 20;
export const SUMMARY_MAX_LENGTH = 600;
/**
 * Hard cap of un-summarised turns kept on the campaign (bounds the Firestore state document). Only
 * reached when the summary call keeps failing; the overflow is then folded into the summary
 * without AI (see `appendTurnRecord`), so the summary still covers every dropped turn.
 */
export const TURN_BUFFER_MAX = 40;
/** Stored text per turn/post (a tweet is at most 280 weighted characters). */
export const STORED_TEXT_MAX = 300;
const TURN_MAX_LENGTH = 240;
const TWEET_LIMIT = 280;

/** Uniform random participant other than `speaker` (strict alternation with two participants). */
export const pickNext = (
  speaker: string,
  participants: readonly string[],
  rng: () => number = Math.random,
): string => {
  const others = participants.filter((id) => id !== speaker);
  if (!others.length) throw new Error('A conversation needs a participant besides the speaker.');
  const i = Math.min(others.length - 1, Math.floor(rng() * others.length));
  return others[i];
};

/** Room for the model's text so that " @next" and the " cc @…" tail still fit in a tweet. */
export const conversationBudget = (nextHandle: string, ccHandles: readonly string[] = []): number =>
  Math.min(
    TURN_MAX_LENGTH,
    TWEET_LIMIT - weightedTweetLength(` @${nextHandle}`) - weightedTweetLength(ccTail(ccHandles)),
  );

const ccTail = (handles: readonly string[]): string =>
  handles.length ? ` cc ${handles.map((h) => `@${h}`).join(' ')}` : '';

/**
 * Tags the other participants (" cc @a @b") who are not mentioned yet, so ANY participant may
 * reply to this turn (X lets an app reply only to posts its account wrote or is mentioned in):
 * a re-picked next speaker (cast edit, removed account) can never hit a 403.
 */
export const appendCc = (text: string, ccHandles: readonly string[]): string =>
  `${text}${ccTail(ccHandles.filter((h) => !mentionsHandle(text, h)))}`;

/** Keeps the text when it already @mentions the next speaker, else ends it with the mention. */
export const ensureMention = (text: string, nextHandle: string, maxLength: number): string => {
  if (mentionsHandle(text, nextHandle)) return text;
  return `${trimToCompleteSentence(text.trim(), maxLength)} @${nextHandle}`;
};

/** De-@s every handle that is not allowed (`@foo` becomes `foo`); allowed ones are kept. */
export const deMentionStrangers = (text: string, allowedHandles: Iterable<string>): string => {
  const allowed = new Set([...allowedHandles].map((h) => h.toLowerCase()));
  // X also treats the fullwidth at-sign (U+FF20) as a mention.
  return text.replace(/(^|[^\w])[@\uFF20](\w+)/g, (all, pre: string, name: string) =>
    allowed.has(name.toLowerCase()) ? all : `${pre}${name}`,
  );
};

export interface TranscriptTurn {
  turn: number;
  handle: string;
  text: string;
}

/** Posted (or simulated) turns of one run of one campaign, oldest first. */
export const buildTranscript = (
  logs: readonly PostLog[],
  contextId: string,
  runId: string,
): TranscriptTurn[] =>
  turnRecordsFromLogs(logs, contextId, runId).map(({ turn, handle, text }) => ({
    turn,
    handle,
    text,
  }));

export const clipStoredText = (text: string): string =>
  text.length > STORED_TEXT_MAX ? `${text.slice(0, STORED_TEXT_MAX - 1)}…` : text;

/** Legacy migration: the run's turns that the (capped) post log still has, oldest first. */
export const turnRecordsFromLogs = (
  logs: readonly PostLog[],
  contextId: string,
  runId: string,
): ConversationTurnRecord[] =>
  logs
    .filter(
      (l) =>
        l.contextId === contextId &&
        l.conversationRunId === runId &&
        (l.status === 'success' || l.status === 'simulated'),
    )
    .map((log, i) => ({ log, i }))
    .sort(
      (a, b) =>
        (a.log.turn ?? 0) - (b.log.turn ?? 0) ||
        a.log.timestamp.localeCompare(b.log.timestamp) ||
        a.i - b.i,
    )
    .map(({ log }, idx) => ({
      turn: log.turn ?? idx + 1,
      accountId: log.accountId ?? '',
      handle: log.accountHandle ?? 'unknown',
      text: clipStoredText(log.tweetText),
      ...(log.tweetId ? { tweetId: log.tweetId } : {}),
      at: log.timestamp,
    }));

/**
 * The buffer to use for `state`: its own `turns`, or (legacy state from before the buffer existed)
 * whatever turns after the summary the post log still has.
 */
export const turnBufferOf = (
  state: ConversationState,
  legacyLogs: () => readonly PostLog[],
  contextId: string,
): ConversationTurnRecord[] => {
  if (state.turns) return state.turns;
  const through = state.summaryThroughTurn ?? 0;
  return turnRecordsFromLogs(legacyLogs(), contextId, state.runId)
    .filter((t) => t.turn > through && t.turn <= state.turnCount)
    .slice(-TURN_BUFFER_MAX);
};

/** Turns the prompt shows word for word: every turn the summary does not cover, oldest first. */
export const unsummarizedTurns = (
  state: Pick<ConversationState, 'summaryThroughTurn'>,
  turns: readonly ConversationTurnRecord[],
): ConversationTurnRecord[] => turns.filter((t) => t.turn > (state.summaryThroughTurn ?? 0));

/** Deterministic (no AI) fold used only when the buffer overflows: keeps the newest content. */
export const fallbackSummary = (
  previous: string | undefined,
  turns: readonly ConversationTurnRecord[],
): string => {
  const lines = turns.map((t) => `@${t.handle}: ${t.text.replace(/\s+/g, ' ').slice(0, 80)}`);
  const merged = [previous, ...lines].filter(Boolean).join(' / ');
  return merged.length > SUMMARY_MAX_LENGTH
    ? `…${merged.slice(merged.length - SUMMARY_MAX_LENGTH + 1)}`
    : merged;
};

/**
 * Appends a posted turn to the state's buffer (mutates `state`) and keeps the invariant
 * "summary covers 1..summaryThroughTurn, `turns` holds every later turn":
 *  - turns the summary already covers are dropped;
 *  - past TURN_BUFFER_MAX the oldest turns are folded into the summary without AI before they go.
 */
export const appendTurnRecord = (state: ConversationState, record: ConversationTurnRecord) => {
  const turns = (state.turns ?? []).filter((t) => t.turn !== record.turn);
  turns.push({ ...record, text: clipStoredText(record.text) });
  turns.sort((a, b) => a.turn - b.turn);
  let kept = unsummarizedTurns(state, turns);
  if (kept.length > TURN_BUFFER_MAX) {
    const overflow = kept.slice(0, kept.length - TURN_BUFFER_MAX);
    state.summary = fallbackSummary(state.summary, overflow);
    state.summaryThroughTurn = overflow[overflow.length - 1].turn;
    kept = kept.slice(overflow.length);
  }
  state.turns = kept;
};

/** True when more than 20 turns have not been folded into the summary yet. */
export const shouldSummarize = (
  state: Pick<ConversationState, 'turnCount' | 'summaryThroughTurn'>,
): boolean => state.turnCount - (state.summaryThroughTurn ?? 0) > SUMMARY_TRIGGER_TURNS;

export const conversationSystemInstruction = (max: number): string =>
  `You write ONE reply in a public X (Twitter) conversation between several accounts. You speak as exactly one of them.
Output ONLY the reply text: no quotes, no preamble, no name labels, no hashtags.
Strictly under ${max} characters. Always end on a complete sentence.
The reply MUST end by addressing the next speaker with their @handle exactly as given.
Never mention anyone else. Stay in character, react to what was said last, don't repeat earlier points.`;

const formatTurns = (turns: readonly TranscriptTurn[]): string =>
  turns.map((t) => `[Turn ${t.turn}] @${t.handle}: "${t.text}"`).join('\n');

export interface ConversationPromptInput {
  sharedPrompt: string;
  persona: string;
  speakerHandle: string;
  /** Handles of everyone except the speaker. */
  otherHandles: string[];
  openerHandle?: string;
  openingPost: string;
  summary?: string;
  summaryThroughTurn?: number;
  /** The turns sent word for word (oldest first). */
  transcript: readonly TranscriptTurn[];
  turnNumber: number;
  nextHandle: string;
  max: number;
}

export const buildConversationPrompt = (
  p: ConversationPromptInput,
): { systemInstruction: string; contents: string } => {
  const others = p.otherHandles.map((h) => `@${h}`).join(', ');
  const summary = p.summary
    ? `EARLIER IN THE CONVERSATION (summary of turns 1–${p.summaryThroughTurn ?? 0}):\n${p.summary}\n\n`
    : '';
  const sofar = p.transcript.length
    ? formatTurns(p.transcript)
    : 'No one has replied yet; you reply to the opening post.';
  const contents = `SHARED PREMISE AND TONE:
${p.sharedPrompt}

YOUR CHARACTER (you are @${p.speakerHandle}):
${p.persona}

You are @${p.speakerHandle}, talking with ${others}${p.openerHandle ? `, in a thread opened by @${p.openerHandle}` : ''}.

OPENING POST${p.openerHandle ? ` by @${p.openerHandle}` : ''}:
"${p.openingPost}"

${summary}CONVERSATION SO FAR (oldest first):
${sofar}

WRITE TURN ${p.turnNumber} AS @${p.speakerHandle}. End by addressing @${p.nextHandle} (write "@${p.nextHandle}" literally, as the last words).
Output ONLY the reply text, under ${p.max} characters, complete sentences.`;
  return { systemInstruction: conversationSystemInstruction(p.max), contents };
};

/** Prompt that folds `turns` into the previous summary (at most 600 characters). */
export const buildSummaryPrompt = (
  previousSummary: string | undefined,
  turns: readonly TranscriptTurn[],
): { systemInstruction: string; contents: string } => ({
  systemInstruction: `You condense a public X (Twitter) conversation between several accounts into a short memory for the writers.
Output ONLY the summary text, plain prose, strictly under ${SUMMARY_MAX_LENGTH} characters.
Keep who said what that matters, running jokes, decisions and open threads. No quotes, no preamble.`,
  contents: `${previousSummary ? `PREVIOUS SUMMARY:\n${previousSummary}\n\n` : ''}TURNS TO FOLD IN (oldest first):
${formatTurns(turns)}

Write the merged summary, under ${SUMMARY_MAX_LENGTH} characters.`,
});
