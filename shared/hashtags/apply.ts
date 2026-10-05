/**
 * Putting hashtags into tweet text (pure).
 */

import { checkTweetText } from '../tweetLength.js';
import { hashtagTokenRegex, normaliseTags } from './normalise.js';

const asBlock = (tags: readonly string[]): string => tags.map((t) => `#${t}`).join(' ');

/**
 * Replaces the template's seed tags in rendered `text` with `newTags`. The new tags take the place
 * of the first seed tag found (the others are removed); when the text has none of the seed tags the
 * new tags are appended.
 */
export function applyHashtags(
  text: string,
  seedTags: readonly string[],
  newTags: readonly string[],
): string {
  const block = asBlock(normaliseTags(newTags));
  const re = hashtagTokenRegex(normaliseTags(seedTags));
  if (!re || !re.test(text)) return block ? `${text.trimEnd()} ${block}` : text;
  re.lastIndex = 0;

  let placed = false;
  const out = text.replace(re, (_match, boundary: string) => {
    const keep = /\s/.test(boundary) ? '' : boundary;
    if (placed || !block) return keep;
    placed = true;
    return `${boundary}${block}`;
  });
  return out.replace(/[ \t]+(\r?\n|$)/g, '$1').trim();
}

export interface FittedHashtags {
  text: string;
  /** The tags that actually made it into `text` (a prefix of the requested tags). */
  tags: string[];
}

/**
 * `applyHashtags`, then enforces the tweet limit by dropping trailing tags one at a time.
 * If even zero tags cannot fit, the original text is returned untouched (the caller's own length
 * guard then rejects it exactly as it would without evolution).
 */
export function fitHashtags(
  text: string,
  seedTags: readonly string[],
  newTags: readonly string[],
): FittedHashtags {
  const tags = normaliseTags(newTags);
  for (let n = tags.length; n >= 0; n--) {
    const candidate = applyHashtags(text, seedTags, tags.slice(0, n));
    if (checkTweetText(candidate).ok) return { text: candidate, tags: tags.slice(0, n) };
  }
  return { text, tags: [] };
}
