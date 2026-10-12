/**
 * One-time migration: the built-in "default account" (`acct_env`, the env-token account) is gone;
 * every campaign posts as a connected account (Settings → X accounts → Connect).
 *
 * Campaigns that used it (no `accountId`, or 'acct_env', or a conversation cast including it) now
 * point at `acct_<its X user id>`: the id that account gets when it is connected again. Until it
 * is connected they are paused with a reason that says so; once connected the owner just resumes
 * them. Without a known user id a single campaign is left without an account (pick one) and a
 * conversation keeps the old id (fix the cast). Runs once per store (`defaultAccountRemoved`).
 */

import type { TweetContext } from '../../shared/types.js';
import type { BotState } from '../store/Store.js';

export const LEGACY_DEFAULT_ACCOUNT_ID = 'acct_env';

const isLegacy = (id?: string | null) => !id || id === LEGACY_DEFAULT_ACCOUNT_ID;

/** Rewrites one campaign; true when it referenced the default account. */
const migrateContext = (ctx: TweetContext, replacement: string | undefined): boolean => {
  if (ctx.mode !== 'conversation') {
    if (!isLegacy(ctx.accountId)) return false;
    ctx.accountId = replacement;
    return true;
  }
  const to = replacement ?? LEGACY_DEFAULT_ACCOUNT_ID;
  const swap = (id?: string | null) => (id === LEGACY_DEFAULT_ACCOUNT_ID ? to : id);
  let touched = false;
  for (const p of ctx.conversation?.participants ?? []) {
    if (p.accountId === LEGACY_DEFAULT_ACCOUNT_ID) {
      p.accountId = to;
      touched = true;
    }
  }
  if (ctx.conversation?.firstSpeakerAccountId === LEGACY_DEFAULT_ACCOUNT_ID) {
    ctx.conversation.firstSpeakerAccountId = to;
  }
  const state = ctx.conversationState;
  if (state) {
    state.nextSpeakerAccountId = swap(state.nextSpeakerAccountId) ?? state.nextSpeakerAccountId;
    for (const t of state.turns ?? []) t.accountId = swap(t.accountId) ?? t.accountId;
  }
  return touched;
};

/** Mutates `state`; returns the names of the campaigns that were paused (empty = nothing to do). */
export function removeDefaultAccount(state: BotState): { ran: boolean; paused: string[] } {
  if (state.defaultAccountRemoved) return { ran: false, paused: [] };
  const legacy = state.defaultAccount ?? {};
  const replacement = legacy.userId ? `acct_${legacy.userId}` : undefined;
  const connected = !!replacement && state.accounts.some((a) => a.id === replacement);
  const who = legacy.handle ? `@${legacy.handle}` : 'The old default account';
  const reason = replacement
    ? `${who} is no longer built in: connect it in Settings → X accounts, then resume`
    : 'The built-in default account was removed: pick a connected account (or fix the cast) and resume';

  const paused: string[] = [];
  for (const ctx of state.contexts) {
    if (!migrateContext(ctx, replacement) || connected) continue;
    paused.push(ctx.name);
    if (ctx.enabled) {
      ctx.enabled = false;
      ctx.pendingFire = undefined;
    }
    ctx.autoPausedReason = reason;
  }

  if (state.accountCooldowns) delete state.accountCooldowns[LEGACY_DEFAULT_ACCOUNT_ID];
  if (state.lastLivePostByAccount) delete state.lastLivePostByAccount[LEGACY_DEFAULT_ACCOUNT_ID];
  if (state.wipeJobs) delete state.wipeJobs[LEGACY_DEFAULT_ACCOUNT_ID];
  if (isLegacy(state.lastRateLimitAccountId)) state.lastRateLimitAccountId = undefined;
  delete state.defaultAccount;
  state.defaultAccountRemoved = true;
  if (paused.length) {
    console.warn(`[Accounts] Default account removed; paused: ${paused.join(', ')} (${reason}).`);
  }
  return { ran: true, paused };
}
