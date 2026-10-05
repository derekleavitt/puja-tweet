/**
 * Conversation campaigns: pure validation and state initialisation (no I/O).
 * `ContextService` applies these on create, patch and restart.
 */

import { HttpError } from '../middleware/error.js';
import { effectiveAccountId } from './accountService.js';
import type { ConversationConfig, ConversationState } from '../../shared/types.js';

export const MIN_PARTICIPANTS = 2;
export const MAX_PARTICIPANTS = 5;

/** True when `text` @mentions `handle` (case-insensitive, whole handle). */
export const mentionsHandle = (text: string, handle: string): boolean =>
  new RegExp(`(^|[^\\w])@${handle}\\b`, 'i').test(text);

const sameHandle = (a?: string, b?: string): boolean =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();

export interface ValidatedConversation {
  config: ConversationConfig;
  /** Participant account id -> handle (no '@'). */
  handles: Map<string, string>;
}

/**
 * Normalises and validates a conversation config (every failure is a 400). `handleOf` returns the
 * known handle of a participant account; `accountExists` says whether the account is usable as an id.
 */
export const validateConversation = (
  input: ConversationConfig | undefined,
  lookup: { accountExists: (id: string) => boolean; handleOf: (id: string) => string | undefined },
): ValidatedConversation => {
  if (!input) throw new HttpError(400, 'Conversation mode needs a conversation setup.');
  const participants = (input.participants ?? []).map((p) => ({
    accountId: effectiveAccountId(p.accountId),
    persona: (p.persona ?? '').trim(),
  }));
  if (participants.length < MIN_PARTICIPANTS || participants.length > MAX_PARTICIPANTS) {
    throw new HttpError(
      400,
      `A conversation needs ${MIN_PARTICIPANTS} to ${MAX_PARTICIPANTS} participants.`,
    );
  }
  const handles = new Map<string, string>();
  for (const p of participants) {
    if (participants.filter((q) => q.accountId === p.accountId).length > 1) {
      throw new HttpError(
        400,
        `Account "${p.accountId}" is listed twice; each participant needs its own account.`,
      );
    }
    if (!lookup.accountExists(p.accountId)) {
      throw new HttpError(
        400,
        `Unknown X account "${p.accountId}". Pick one connected under Settings, X accounts.`,
      );
    }
    const handle = lookup.handleOf(p.accountId);
    if (!handle) {
      throw new HttpError(
        400,
        `Verify @handle first: account "${p.accountId}" has no known handle yet (verify it under Settings, X accounts).`,
      );
    }
    handles.set(p.accountId, handle);
  }

  const openerHandle = input.openerHandle?.trim().replace(/^@/, '') || undefined;
  const openingPost = (input.openingPost ?? '').trim();
  const firstSpeakerAccountId = input.firstSpeakerAccountId
    ? effectiveAccountId(input.firstSpeakerAccountId)
    : undefined;
  if (firstSpeakerAccountId) {
    if (!handles.has(firstSpeakerAccountId)) {
      throw new HttpError(400, 'The first speaker must be one of the participants.');
    }
    const first = handles.get(firstSpeakerAccountId) as string;
    if (sameHandle(first, openerHandle)) {
      throw new HttpError(
        400,
        `@${first} posted the opening post, so it cannot also speak first (it cannot reply to itself).`,
      );
    }
    if (!mentionsHandle(openingPost, first)) {
      throw new HttpError(
        400,
        `The opening post must mention @${first} (X only lets an account reply to a post that mentions it).`,
      );
    }
  }

  const config: ConversationConfig = {
    participants,
    sharedPrompt: (input.sharedPrompt ?? '').trim(),
    openingPost,
    ...(openerHandle ? { openerHandle } : {}),
    ...(firstSpeakerAccountId ? { firstSpeakerAccountId } : {}),
    ...(input.maxTurns ? { maxTurns: input.maxTurns } : {}),
  };
  return { config, handles };
};

const pickRandom = <T>(items: T[]): T => items[Math.floor(Math.random() * items.length)];

/**
 * First speaker of a run: the configured one, else a random participant among those the opening post
 * mentions (the opener itself excluded), else any participant but the opener.
 */
export const pickFirstSpeaker = (
  config: ConversationConfig,
  handles: Map<string, string>,
): string => {
  if (config.firstSpeakerAccountId) return config.firstSpeakerAccountId;
  const ids = config.participants.map((p) => p.accountId);
  const notOpener = ids.filter((id) => !sameHandle(handles.get(id), config.openerHandle));
  const pool = notOpener.length ? notOpener : ids;
  const mentioned = pool.filter((id) => mentionsHandle(config.openingPost, handles.get(id) ?? ''));
  return pickRandom(mentioned.length ? mentioned : pool);
};

/** Fresh progress for a new run (create, restart, new target, mode switch). */
export const initConversationState = (
  config: ConversationConfig,
  handles: Map<string, string>,
): ConversationState => ({
  runId: `run_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
  turnCount: 0,
  nextSpeakerAccountId: pickFirstSpeaker(config, handles),
});

/** Random participant of the (edited) cast; used when the planned next speaker left the cast. */
export const repickNextSpeaker = (config: ConversationConfig): string =>
  pickRandom(config.participants).accountId;
