/**
 * Tweet length helpers (pure). X weights URLs as 23 chars and most emoji / astral
 * code points as 2. Used server-side before posting and to bound Gemini output.
 */

export const MAX_TWEET_LENGTH = 280;
export const AGENT_TARGET_LENGTH = 240;
const URL_WEIGHT = 23;
const URL_REGEX = /https?:\/\/[^\s]+/gi;

function codePointWeight(cp: number): number {
  return cp > 0xffff ? 2 : 1;
}

/** Weighted tweet length: each URL counts 23, astral code points (emoji) count 2. */
export function weightedTweetLength(text: string): number {
  let total = 0;
  const stripped = text.replace(URL_REGEX, () => {
    total += URL_WEIGHT;
    return '';
  });
  for (const ch of stripped) total += codePointWeight(ch.codePointAt(0) ?? 0);
  return total;
}

/** Truncate at a word boundary so the weighted length is <= max (adds an ellipsis when cut). */
/**
 * Shortens text to `max` weighted chars, preferring to end on a complete sentence so a tweet never
 * stops mid-thought. Falls back to a word boundary + "…" only when no sentence end fills at least
 * 30% of the limit.
 */
export function trimToCompleteSentence(text: string, max = AGENT_TARGET_LENGTH): string {
  if (weightedTweetLength(text) <= max) return text;
  const cut = truncateAtWordBoundary(text, max + 1).replace(/…$/, '');
  const ends = [...cut.matchAll(/[.!?…](?=["'”’)\]]*(\s|$))/g)];
  const last = ends.length ? ends[ends.length - 1] : undefined;
  if (last && last.index !== undefined) {
    const sentence = cut.slice(0, last.index + 1).trim();
    if (weightedTweetLength(sentence) >= max * 0.3 && weightedTweetLength(sentence) <= max)
      return sentence;
  }
  return truncateAtWordBoundary(text, max);
}

export function truncateAtWordBoundary(text: string, max = AGENT_TARGET_LENGTH): string {
  if (weightedTweetLength(text) <= max) return text;
  const budget = max - 1;
  let out = '';
  let used = 0;
  for (const ch of text) {
    const w = codePointWeight(ch.codePointAt(0) ?? 0);
    if (used + w > budget) break;
    out += ch;
    used += w;
  }
  const lastSpace = out.search(/\s\S*$/);
  if (lastSpace > 0) out = out.slice(0, lastSpace);
  return out.replace(/[\s,;:.\-–—]+$/, '') + '…';
}

export type TweetTextCheck =
  { ok: true; length: number } | { ok: false; error: 'text_invalid'; length: number };

/** Validate final text before posting. Rejects empty or > 280 weighted chars. */
export function checkTweetText(text: string, max = MAX_TWEET_LENGTH): TweetTextCheck {
  const length = weightedTweetLength(text);
  if (!text.trim() || length > max) return { ok: false, error: 'text_invalid', length };
  return { ok: true, length };
}
