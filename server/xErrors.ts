/**
 * X API error classification for X ChromaBot.
 * Pure helper: maps an HTTP status + response body to a class the drop service and the
 * scheduler's circuit breaker act on (chain recovery, cooldowns, auto-pause).
 */

export type XErrorClass =
  | 'rate_limit'
  | 'cooldown'
  | 'reply_restricted'
  | 'auth'
  /** The campaign's X account is removed, revoked or unreadable: nothing was sent to X. */
  | 'account'
  | 'payment'
  | 'target_missing'
  | 'text_invalid'
  /** No HTTP answer at all (connection error or timeout). Transient. */
  | 'network'
  /** X answered 5xx (overloaded / internal error). Transient. */
  | 'server_error'
  /** The AI (Gemini) could not write the post: busy, timed out or not reachable. Transient. */
  | 'ai_unavailable'
  | 'unknown';

/** Failures worth retrying soon and never a reason to auto-pause a campaign. */
const TRANSIENT: ReadonlySet<XErrorClass> = new Set(['network', 'server_error', 'ai_unavailable']);

export const isTransientFailure = (cls: XErrorClass | undefined): boolean =>
  !!cls && TRANSIENT.has(cls);

/** Short label for the UI ("Retrying in 2m (AI busy)"). */
export const transientReason = (cls: XErrorClass): string =>
  cls === 'ai_unavailable'
    ? 'AI busy'
    : cls === 'server_error'
      ? 'X server error'
      : 'network error';

const detailOf = (body: unknown): string => {
  if (typeof body === 'string') return body.toLowerCase();
  if (!body || typeof body !== 'object') return '';
  const b = body as { detail?: unknown; title?: unknown; errors?: { message?: unknown }[] };
  return [b.detail, b.title, b.errors?.[0]?.message]
    .filter((v): v is string => typeof v === 'string')
    .join(' ')
    .toLowerCase();
};

export const classifyXError = (status: number | undefined, body?: unknown): XErrorClass => {
  const detail = detailOf(body);
  // No status: a connection error / timeout, unless the client refused before sending anything.
  if (!status) return detail.includes('invalid target tweet id') ? 'unknown' : 'network';
  if (status === 429) return 'rate_limit';
  if (status === 401) return 'auth';
  if (status === 402 || detail.includes('credits depleted')) return 'payment';
  if (status === 404) return 'target_missing';
  if (status === 403) {
    if (detail.includes('not permitted to access this feature') || detail.includes('cooldown')) {
      return 'cooldown';
    }
    if (/referenced (tweet|post)|(tweet|post)[^.]*(not exist|deleted|not found)/.test(detail)) {
      return 'target_missing';
    }
    if (/reply to this conversation is not allowed|not been mentioned or engaged/.test(detail)) {
      return 'reply_restricted';
    }
    if (detail.includes('duplicate')) return 'text_invalid';
    return 'unknown';
  }
  if (status === 400 || status === 422) {
    return /too long|duplicate|invalid|character/.test(detail) ? 'text_invalid' : 'unknown';
  }
  if (status >= 500) return 'server_error';
  return 'unknown';
};
