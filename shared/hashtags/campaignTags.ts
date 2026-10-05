/**
 * The campaign's own hashtags (`TweetContext.hashtags`), kept OUTSIDE the template text (pure).
 * The template renders the body; the tag block is appended after it.
 */

import { THEMES } from './graph.js';
import { isHashtagExpression, hashtagDedupeKey } from './agentText.js';
import { normaliseTags, tagKey } from './normalise.js';
import { templateUsesColor } from '../template/colorTokens.js';
import { checkTweetText, weightedTweetLength } from '../tweetLength.js';

export const MAX_CAMPAIGN_TAGS = 10;
const AGENT_BLOCK = /<agent(?:\s+history=["']?true["']?)?>[\s\S]*?<\/agent>/gi;
const TAG_TOKEN = /(^|[^\p{L}\p{N}_&/#])#([\p{L}\p{N}_]+)(?![\p{L}\p{N}_])/gu;
const MARK = '\uE000';

/** Normalised, de-duplicated campaign tags (at most 10). */
export const normaliseCampaignTags = (raw: readonly unknown[] | undefined): string[] =>
  normaliseTags((raw ?? []).filter((t): t is string => typeof t === 'string')).slice(
    0,
    MAX_CAMPAIGN_TAGS,
  );

/** Tidies only the lines a tag was removed from; a tags-only line disappears. */
function tidyMarkedLines(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  let droppedLast = false;
  lines.forEach((line, i) => {
    if (!line.includes(MARK)) return void out.push(line);
    const cleaned = line
      .replace(new RegExp(MARK, 'g'), ' ')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/ +([,.;:!?])/g, '$1')
      .trim();
    if (cleaned) out.push(cleaned);
    else if (i === lines.length - 1) droppedLast = true;
  });
  const joined = out.join('\n');
  // A tags-only last line keeps its line break, so the block is appended on its own line again.
  return droppedLast && joined.trim() ? `${joined.trimEnd()}\n` : joined.trimEnd();
}

/**
 * Moves the template's literal hashtags (outside `<agent>` prompts; `{weather_tweet}` is a token and
 * is left alone) into a tag list. When nothing but tags would remain, the template is kept as is.
 */
export function extractTemplateHashtags(template: string): {
  template: string;
  hashtags: string[];
} {
  const found: string[] = [];
  const strip = (segment: string) =>
    segment.replace(TAG_TOKEN, (match, boundary: string, body: string) => {
      if (isHashtagExpression(body)) return match;
      found.push(body);
      return `${boundary}${MARK}`;
    });
  let out = '';
  let last = 0;
  for (const m of template.matchAll(AGENT_BLOCK)) {
    out += strip(template.slice(last, m.index)) + m[0];
    last = (m.index ?? 0) + m[0].length;
  }
  out += strip(template.slice(last));
  const hashtags = normaliseCampaignTags(found);
  if (found.length === 0) return { template, hashtags: [] };
  const tidied = tidyMarkedLines(out);
  if (!tidied.trim()) return { template, hashtags: [] };
  return { template: tidied, hashtags };
}

/** One-time move of template tags into `hashtags` (no-op once `hashtags` is defined). */
export function migrateCampaignHashtags<T extends { template: string; hashtags?: string[] }>(
  ctx: T,
): boolean {
  if (ctx.hashtags !== undefined) return false;
  const moved = extractTemplateHashtags(ctx.template ?? '');
  ctx.template = moved.template;
  ctx.hashtags = moved.hashtags;
  return true;
}

const SYNONYMS: Readonly<Record<string, string>> = {
  time: 'timeless',
  times: 'timeless',
  poem: 'poetry',
  poems: 'poetry',
  poetic: 'poetry',
  loving: 'love',
  loved: 'love',
  devoted: 'devotion',
  eternally: 'eternal',
  hearts: 'heart',
  dreams: 'dream',
  stars: 'starlight',
  moon: 'moonlight',
};
const COLOR_TERMS = new Set(THEMES.color.map(tagKey));
const NEUTRAL_TERMS = new Map(
  Object.entries(THEMES)
    .filter(([theme]) => theme !== 'color')
    .flatMap(([, terms]) => terms)
    .filter((t) => !COLOR_TERMS.has(tagKey(t)))
    .map((t) => [tagKey(t), t] as const),
);
export const NEUTRAL_FALLBACK_TAG = 'poetry';
export const COLOR_FALLBACK_TAG = 'colors';

/**
 * Seed theme when a campaign has no tags of its own and no history: `#colors` only for templates
 * that use color tokens; otherwise up to 3 neutral (non-color) terms found in the template / agent
 * prompt ("love", "devotion", "time" -> #timeless ...), else `#poetry`.
 */
export function themeSeedTags(template: string): string[] {
  if (!template || templateUsesColor(template)) return [COLOR_FALLBACK_TAG];
  const words = template
    .replace(/<\/?[a-z]+[^>]*>/gi, ' ')
    .toLocaleLowerCase()
    .split(/[^\p{L}]+/u);
  const picked: string[] = [];
  for (const word of words) {
    const term = NEUTRAL_TERMS.get(SYNONYMS[word] ?? word);
    if (term && !picked.some((p) => tagKey(p) === tagKey(term))) picked.push(term);
    if (picked.length === 3) break;
  }
  return picked.length ? picked : [NEUTRAL_FALLBACK_TAG];
}

export const formatTagBlock = (tags: readonly string[]): string =>
  tags.map((t) => `#${t}`).join(' ');

/** Appends the tag block after the body: one space, or directly when the body ends with a newline. */
export function appendTagBlock(body: string, tags: readonly string[]): string {
  const block = formatTagBlock(tags);
  if (!block) return body.trim();
  const trimmed = body.replace(/[ \t]+$/, '');
  if (!trimmed.trim()) return block;
  return /\n$/.test(trimmed) ? `${trimmed.trimStart()}${block}` : `${trimmed.trim()} ${block}`;
}

/** Weighted length the tag block adds to a body (separator included). */
export const tagBlockLength = (tags: readonly string[]): number =>
  tags.length ? weightedTweetLength(formatTagBlock(tags)) + 1 : 0;

/** `appendTagBlock`, dropping trailing tags until the tweet fits 280 (last resort). */
export function fitTagBlock(
  body: string,
  tags: readonly string[],
): { text: string; tags: string[] } {
  for (let n = tags.length; n >= 0; n--) {
    const text = appendTagBlock(body, tags.slice(0, n));
    if (checkTweetText(text).ok) return { text, tags: tags.slice(0, n) };
  }
  return { text: appendTagBlock(body, []), tags: [] };
}

/**
 * Folds the AI's own (lifted) tags into an evolved set: they replace evolved tags from the end
 * (never the kept campaign tags), at most half of the evolving slots (rounded up), skipping blocked
 * (recent / campaign) tags, and only while the block does not get longer than the reserved one.
 */
export function foldAiTags(
  tags: readonly string[],
  candidates: readonly string[],
  opts: { kept: number; blocked?: readonly string[] },
): { tags: string[]; folded: string[] } {
  const out = [...tags];
  const reserved = tagBlockLength(tags);
  const blocked = new Set([...(opts.blocked ?? []), ...tags].map(hashtagDedupeKey));
  const evolving = out.length - opts.kept;
  const limit = Math.ceil(evolving / 2);
  const folded: string[] = [];
  for (const candidate of normaliseTags(candidates)) {
    if (folded.length >= limit) break;
    if (blocked.has(hashtagDedupeKey(candidate))) continue;
    const slot = out.length - 1 - folded.length;
    if (slot < opts.kept) break;
    const trial = [...out];
    trial[slot] = candidate;
    if (tagBlockLength(trial) > reserved) continue;
    out.splice(0, out.length, ...trial);
    blocked.add(hashtagDedupeKey(candidate));
    folded.push(candidate);
  }
  // The AI's tags go last, in the order the AI wrote them.
  return { tags: [...out.slice(0, out.length - folded.length), ...folded], folded };
}
