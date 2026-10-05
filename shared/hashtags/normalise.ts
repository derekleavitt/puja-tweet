/**
 * Hashtag parsing and normalisation (pure, isomorphic: no Node or DOM APIs).
 * Tags are stored WITHOUT the leading '#', e.g. 'SunsetTopaz'.
 */

export const MIN_TAG_LENGTH = 2;
export const MAX_TAG_LENGTH = 30;

const TAG_SEPARATORS = /[^\p{L}\p{N}_]+/u;
/** `#tag` not glued to a word, URL fragment or another '#'. Group 1 = the boundary, 2 = the tag. */
const HASHTAG_SOURCE = String.raw`(^|[^\p{L}\p{N}_&/#])#([\p{L}\p{N}_]+)`;
const AGENT_BLOCK = /<agent(?:\s+history=["']?true["']?)?>[\s\S]*?<\/agent>/gi;

/** Case-insensitive identity of a tag. */
export const tagKey = (tag: string): string => tag.replace(/^#+/, '').toLocaleLowerCase();

const capitalise = (word: string): string => word.charAt(0).toLocaleUpperCase() + word.slice(1);

/**
 * Cleans one raw tag: strips '#', turns separators into CamelCase ("sunset topaz" -> "SunsetTopaz"),
 * keeps the casing of single tokens, and enforces 2-30 chars of letters/digits/underscore.
 * Returns null for anything unusable (too short/long, digits only).
 */
export function normaliseTag(raw: string): string | null {
  const parts = raw.trim().replace(/^#+/, '').split(TAG_SEPARATORS).filter(Boolean);
  if (parts.length === 0) return null;
  const tag = parts.length === 1 ? parts[0] : parts.map(capitalise).join('');
  const length = [...tag].length;
  if (length < MIN_TAG_LENGTH || length > MAX_TAG_LENGTH) return null;
  if (/^[\p{N}_]+$/u.test(tag)) return null; // X does not link number-only hashtags
  return tag;
}

/** Normalises a list: invalid entries dropped, duplicates removed case-insensitively (first wins). */
export function normaliseTags(raw: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const tag = normaliseTag(item);
    if (!tag || seen.has(tagKey(tag))) continue;
    seen.add(tagKey(tag));
    out.push(tag);
  }
  return out;
}

/** Hashtags found in `text`, in order, normalised and de-duplicated (without the '#'). */
export function parseHashtags(text: string): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(new RegExp(HASHTAG_SOURCE, 'gu'))) found.push(m[2]);
  return normaliseTags(found);
}

/** Regex matching `#tag` (any of `tags`, case-insensitive) as a whole token; group 1 = boundary. */
export function hashtagTokenRegex(tags: readonly string[]): RegExp | null {
  if (tags.length === 0) return null;
  const alt = tags.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return new RegExp(String.raw`(^|[^\p{L}\p{N}_&/#])#(?:${alt})(?![\p{L}\p{N}_])`, 'giu');
}

/** Removes `<agent>` prompt blocks so hashtags inside prompts are not mistaken for template tags. */
export const stripAgentBlocks = (template: string): string => template.replace(AGENT_BLOCK, ' ');
