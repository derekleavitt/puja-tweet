/**
 * Turn limits for conversation campaigns. `maxTurns` is per round: resuming a finished
 * conversation starts a new round of `maxTurns` more turns in the same thread
 * (`roundStartTurn` = the turn count when that round began).
 */

import type { ConversationState } from './types.js';

/** Turns posted in the current round. */
export const roundTurns = (state?: Pick<ConversationState, 'turnCount' | 'roundStartTurn'>) =>
  (state?.turnCount ?? 0) - (state?.roundStartTurn ?? 0);

/** True when the current round has reached its limit (never for unlimited conversations). */
export const roundFinished = (
  state: Pick<ConversationState, 'turnCount' | 'roundStartTurn'> | undefined,
  maxTurns: number | undefined,
): boolean => !!maxTurns && roundTurns(state) >= maxTurns;
