/**
 * Hashtags inside generated (AI) text and across the whole tweet (pure).
 *
 * - "Expressions" that only look like hashtags (#1, #2026, #C03F0B hex codes, C#, URL #fragments,
 *   HTML entities like &#39;) are never touched.
 * - A trailing cluster of hashtags can be lifted out of a text (`splitTrailingHashtags`).
 * - Inline hashtags can be turned into plain words ("this #love burns" -> "this love burns").
 * - Duplicates (case-insensitive, CamelCase/underscore variants equal) are removed or de-hashed.
 */

import { trimToCompleteSentence, weightedTweetLength } from '../tweetLength.js';
import { normaliseTag, tagKey } from './normalise.js';

/** `#tag` not glued to a word, URL, entity or another '#'. Group 1 = boundary, 2 = tag body. */
const TAG_TOKEN = String.raw`(^|[^\p{L}\p{N}_&/#])#([\p{L}\p{N}_]+)(?![\p{L}\p{N}_])`;
const HEX_CODE = /^(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const SENTENCE_END = /[.!?…:;"”'’)\]]$/u;
const PICTOGRAPHIC_ONLY = /^[^\p{L}\p{N}]+$/u;

/** True for "#body" that is an expression rather than a hashtag (number, hex color, unusable). */
export const isHashtagExpression = (body: string): boolean =>
  !normaliseTag(body) || (HEX_CODE.test(body) && /\d/.test(body));

/** Identity used for "same hashtag": case-insensitive, underscores ignored (#Eternal_Love = #eternallove). */
export const hashtagDedupeKey = (tag: string): string => tagKey(tag).replace(/_/g, '');

/** "EternalLove" -> "Eternal Love", "golden_hour" -> "golden hour"; acronyms stay ("NYC"). */
export const dehashWord = (body: string): string =>
  body
    .replace(/_+/g, ' ')
    .replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2')
    .trim();

/** Real hashtags in `text` (expressions excluded), in order, as written (duplicates kept). */
export function findHashtags(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(new RegExp(TAG_TOKEN, 'gu'))) {
    if (!isHashtagExpression(m[2])) out.push(m[2]);
  }
  return out;
}

export interface TrailingCluster {
  /** Text without the lifted tags (expressions/emoji found in the cluster stay, in order). */
  body: string;
  /** Lifted tags (without '#', as written). */
  tags: string[];
}

type TokenKind =
  | { kind: 'tag'; tag: string; keep: string; punctuated: boolean }
  | { kind: 'keep' }
  | { kind: 'stop' };

const classifyToken = (token: string): TokenKind => {
  const m = token.match(/^#([\p{L}\p{N}_]+)(.*)$/u);
  if (m) {
    if (/[\p{L}\p{N}]/u.test(m[2])) return { kind: 'stop' };
    if (isHashtagExpression(m[1])) return { kind: 'keep' };
    // Glued punctuation is dropped with the tag; glued emoji stays in the body.
    const keep = /\p{Extended_Pictographic}/u.test(m[2]) ? m[2].replace(/[\p{P}\s]/gu, '') : '';
    return { kind: 'tag', tag: m[1], keep, punctuated: /\p{P}/u.test(m[2]) };
  }
  return PICTOGRAPHIC_ONLY.test(token) && /\p{Extended_Pictographic}/u.test(token)
    ? { kind: 'keep' }
    : { kind: 'stop' };
};

/**
 * Lifts the cluster of hashtags at the very end of `text`. A cluster counts when it holds at least
 * two tags, or one tag that stands on its own (after a line break or a sentence end). A single tag
 * glued to the end of a sentence ("this love is #endless") is NOT a cluster: it is inline.
 */
export function splitTrailingHashtags(text: string): TrailingCluster {
  const parts = text.trimEnd().split(/(\s+)/);
  const tags: string[] = [];
  const kept: string[] = [];
  let i = parts.length - 1;
  for (; i >= 0; i -= 2) {
    const token = classifyToken(parts[i]);
    if (token.kind === 'stop') break;
    // "… stays #Love. #poetry": a punctuated tag before the last token ends a sentence.
    if (token.kind === 'tag' && token.punctuated && i !== parts.length - 1) break;
    if (token.kind === 'tag') {
      tags.unshift(token.tag);
      if (token.keep) kept.unshift(token.keep);
    } else kept.unshift(parts[i]);
  }
  if (tags.length === 0) return { body: text, tags: [] };
  const before = parts.slice(0, Math.max(0, i + 1)).join('');
  const separator = i >= 0 ? (parts[i + 1] ?? '') : '';
  const standalone =
    !before.trim() || separator.includes('\n') || SENTENCE_END.test(before.trimEnd());
  if (tags.length < 2 && !standalone) return { body: text, tags: [] };
  const tail = kept.join(' ');
  const body = tail ? `${before.trimEnd()}${before.trim() ? separator || ' ' : ''}${tail}` : before;
  return { body: body.trimEnd(), tags };
}

/** Turns inline hashtags into plain words; `only` limits it to some tags (by dedupe key). */
export function dehashInline(
  text: string,
  only?: (tag: string) => boolean,
): { text: string; dehashed: string[] } {
  const dehashed: string[] = [];
  const out = text.replace(new RegExp(TAG_TOKEN, 'gu'), (match, boundary: string, body: string) => {
    if (isHashtagExpression(body) || (only && !only(body))) return match;
    dehashed.push(body);
    return `${boundary}${dehashWord(body)}`;
  });
  return { text: out, dehashed };
}

const isTagToken = (token: string | undefined) =>
  !!token &&
  /^#[\p{L}\p{N}_]/u.test(token) &&
  !isHashtagExpression(token.slice(1).replace(/[^\p{L}\p{N}_].*$/u, ''));

/** A tag that sits among other tags (or alone at a line end after a sentence) can simply go. */
function inCluster(text: string, start: number, end: number): boolean {
  const after = text.slice(end);
  const before = text.slice(0, start);
  const next = after.match(/^[ \t]*(\S*)/u)?.[1];
  const prev = before.match(/(\S*)[ \t]*$/u)?.[1];
  if (isTagToken(next) || isTagToken(prev)) return true;
  const atLineEnd = /^[ \t]*(\n|$)/.test(after);
  const atLineStart = /(^|\n)[ \t]*$/.test(before);
  return (
    atLineEnd &&
    (atLineStart || SENTENCE_END.test(prev ?? '') || PICTOGRAPHIC_ONLY.test(prev ?? ''))
  );
}

/** Collapses the gaps left by removed tags (never touches line breaks or other spacing). */
const tidy = (text: string): string =>
  text
    .replace(/[ \t]*\uE000[ \t]*/g, '\uE000')
    .replace(/(\S)\uE000+(?=\S)/gu, '$1 ')
    .replace(/\uE000/g, '')
    .replace(/[ \t]+(\r?\n|$)/g, '$1');

/**
 * Keeps only the first occurrence of every hashtag. Later occurrences (and any tag in `reserved`,
 * e.g. the tag block appended after the body) are removed when they sit in a tag cluster, or turned
 * into a plain word when they are part of a sentence.
 */
export function dedupeHashtags(
  text: string,
  reserved: readonly string[] = [],
): { text: string; removed: string[] } {
  const seen = new Set(reserved.map(hashtagDedupeKey));
  const removed: string[] = [];
  const re = new RegExp(TAG_TOKEN, 'gu');
  const out = text.replace(re, (match, boundary: string, body: string, offset: number) => {
    if (isHashtagExpression(body)) return match;
    const key = hashtagDedupeKey(body);
    if (!seen.has(key)) {
      seen.add(key);
      return match;
    }
    removed.push(body);
    const start = offset + boundary.length;
    if (inCluster(text, start, start + body.length + 1)) return `${boundary}\uE000`;
    return `${boundary}${dehashWord(body)}`;
  });
  return { text: removed.length ? tidy(out) : text, removed };
}

export interface ShapedAgentText {
  /** AI text without the hashtags that were lifted out. */
  body: string;
  /** Tags kept at the end of the AI text (only when the app does NOT manage hashtags). */
  tail: string[];
  /** Trailing-cluster tags lifted out (app manages hashtags): candidates for evolution. */
  lifted: string[];
  /** Inline tags turned into plain words. */
  dehashed: string[];
  /** Tags removed because they duplicate the template or an earlier tag. */
  removed: string[];
}

export interface ShapeOptions {
  /** True when the campaign has a tag block (own hashtags or evolution): AI must not add tags. */
  managed: boolean;
  /** Tags already written literally in the template's static text. */
  reservedTags?: readonly string[];
}

/** Applies the AI-hashtag rules (see docs/hashtags.md) to one generated text. */
export function shapeAgentText(text: string, opts: ShapeOptions): ShapedAgentText {
  const cluster = splitTrailingHashtags(text);
  if (opts.managed) {
    const inline = dehashInline(cluster.body);
    return {
      body: inline.text,
      tail: [],
      lifted: cluster.tags,
      dehashed: inline.dehashed,
      removed: [],
    };
  }
  // Not managed: the model's tags stay, minus duplicates of the template or of each other.
  const body = dedupeHashtags(cluster.body, opts.reservedTags ?? []);
  const seen = new Set(
    [...(opts.reservedTags ?? []), ...findHashtags(body.text)].map(hashtagDedupeKey),
  );
  const tail: string[] = [];
  const removed = [...body.removed];
  for (const tag of cluster.tags) {
    if (seen.has(hashtagDedupeKey(tag))) removed.push(tag);
    else {
      seen.add(hashtagDedupeKey(tag));
      tail.push(tag);
    }
  }
  return { body: body.text, tail, lifted: [], dehashed: [], removed };
}

const cutMidSentence = (out: string, source: string) => out !== source && out.endsWith('…');

/**
 * Fits shaped AI text into `max` weighted chars: the body ends on a complete sentence
 * (`trimToCompleteSentence`). When that is only possible beyond `max` (the room left after the
 * campaign's tag block) but within `hardMax` (no tag block), the longer complete sentence wins and the
 * caller drops trailing tags instead. Kept tail tags are dropped from the end until they fit.
 */
export function finishAgentText(
  shaped: Pick<ShapedAgentText, 'body' | 'tail'>,
  max: number,
  hardMax = max,
): { text: string; droppedTail: string[] } {
  let body = trimToCompleteSentence(shaped.body, max);
  if (cutMidSentence(body, shaped.body) && hardMax > max) {
    const alt = trimToCompleteSentence(shaped.body, hardMax);
    if (!cutMidSentence(alt, shaped.body)) body = alt;
  }
  const tail = [...shaped.tail];
  const droppedTail: string[] = [];
  const join = () => (tail.length ? `${body} ${tail.map((t) => `#${t}`).join(' ')}` : body);
  while (tail.length && weightedTweetLength(join()) > Math.max(max, weightedTweetLength(body))) {
    droppedTail.unshift(tail.pop() as string);
  }
  return { text: join(), droppedTail };
}
