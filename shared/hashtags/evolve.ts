/**
 * Offline hashtag evolution: walks a built-in related-terms graph (no network, no Gemini).
 * Deterministic when given an `rng`, so tests can pin the output.
 */

import { clampMaxTags } from './config.js';
import { ALL_TERMS, relatedTerms } from './graph.js';
import { normaliseTag, normaliseTags, tagKey } from './normalise.js';

export interface EvolveOptions {
  /** Recently used tags that must not come back. */
  recent?: readonly string[];
  /** Drop's color name ("Sunset Topaz" -> #SunsetTopaz). */
  colorName?: string;
  maxTags?: number;
  /** Keep the template's own tags (they count toward maxTags; one slot always evolves). */
  keepSeedTags?: boolean;
  /** The template's seed tags. */
  seed?: readonly string[];
  rng?: () => number;
}

/** Seed tags that survive "keep my original hashtags"; one slot always stays free to evolve. */
export const keptSeedTags = (seed: readonly string[], max: number, keep: boolean | undefined) =>
  keep ? seed.slice(0, Math.max(0, max - 1)) : [];

type Pool = Map<string, { label: string; score: number }>;

/** Picks `count` labels without replacement, weighted by score. */
function pickWeighted(pool: Pool, count: number, rng: () => number): string[] {
  const picked: string[] = [];
  const left = [...pool.values()];
  while (picked.length < count && left.length > 0) {
    const total = left.reduce((sum, c) => sum + c.score, 0);
    let r = rng() * total;
    let idx = left.findIndex((c) => (r -= c.score) < 0);
    if (idx === -1) idx = left.length - 1;
    picked.push(left[idx].label);
    left.splice(idx, 1);
  }
  return picked;
}

/**
 * Next tag set (without '#') given the `previous` tags: [kept seed tags] + [color-name tag] +
 * graph neighbours of the previous/seed tags. Never contains anything in `recent`; at most
 * `maxTags` long.
 */
export function evolveOffline(previous: readonly string[], opts: EvolveOptions = {}): string[] {
  const rng = opts.rng ?? Math.random;
  const max = clampMaxTags(opts.maxTags);
  const seed = normaliseTags(opts.seed ?? []);
  const kept = keptSeedTags(seed, max, opts.keepSeedTags);
  const blocked = new Set([...(opts.recent ?? []), ...seed].map(tagKey));
  const result = [...kept];

  const colorTag = opts.colorName ? normaliseTag(opts.colorName) : null;
  if (colorTag && !blocked.has(tagKey(colorTag)) && result.length < max) {
    result.push(colorTag);
    blocked.add(tagKey(colorTag));
  }

  const pool: Pool = new Map();
  const consider = (terms: readonly string[], weight: number) => {
    for (const term of terms) {
      const key = tagKey(term);
      if (blocked.has(key)) continue;
      const entry = pool.get(key) ?? { label: term, score: 0 };
      entry.score += weight;
      pool.set(key, entry);
    }
  };
  for (const anchor of normaliseTags([...previous, ...seed])) consider(relatedTerms(anchor), 3);
  if (pool.size < max - result.length) consider(ALL_TERMS, 1); // unknown anchors / exhausted theme

  return [...result, ...pickWeighted(pool, max - result.length, rng)];
}
