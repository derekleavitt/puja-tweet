/**
 * Evolving-hashtag config defaults, seed detection and state bookkeeping (pure).
 */

import type { HashtagEvolutionConfig, HashtagState } from '../types.js';
import { WEATHER_TWEET_TAGS } from '../template/substitute.js';
import { themeSeedTags } from './campaignTags.js';
import { parseHashtags, stripAgentBlocks, tagKey } from './normalise.js';

export const MIN_EVOLVED_TAGS = 1;
export const MAX_EVOLVED_TAGS = 5;
/** How many recently used tags are remembered so they are not repeated. */
export const RECENT_LIMIT = 40;
/** Seed used when a color template carries no hashtag at all (see `themeSeedTags`). */
export const FALLBACK_SEED_TAG = 'colors';

export const DEFAULT_HASHTAG_EVOLUTION: HashtagEvolutionConfig = {
  enabled: false,
  maxTags: 3,
  keepSeedTags: false,
};

export const clampMaxTags = (n: unknown): number => {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return DEFAULT_HASHTAG_EVOLUTION.maxTags;
  return Math.min(MAX_EVOLVED_TAGS, Math.max(MIN_EVOLVED_TAGS, v));
};

/** Fills gaps of (possibly partial) configs with the defaults and clamps maxTags to 1-5. */
export function normaliseEvolution(
  ...layers: Array<Partial<HashtagEvolutionConfig> | undefined>
): HashtagEvolutionConfig {
  const merged: Partial<HashtagEvolutionConfig> = Object.assign(
    {},
    DEFAULT_HASHTAG_EVOLUTION,
    ...layers,
  );
  return {
    enabled: merged.enabled === true,
    maxTags: clampMaxTags(merged.maxTags),
    keepSeedTags: merged.keepSeedTags === true,
  };
}

export interface SeedTags {
  /** Hashtags literally present in the template (what gets replaced in the rendered text). */
  found: string[];
  /** What evolution starts from: `found`, or a theme (`themeSeedTags`) when the template has none. */
  seed: string[];
}

/** Seed hashtags of a template; `{weather_tweet}` counts for the tags it expands to. */
export function getSeedTags(template: string): SeedTags {
  const text = stripAgentBlocks(template).replace(/{weather_tweet}/g, ` ${WEATHER_TWEET_TAGS} `);
  const found = parseHashtags(text);
  return { found, seed: found.length > 0 ? found : themeSeedTags(template) };
}

/** State after a successful post: `used` becomes current and joins the (capped) recent list. */
export function advanceHashtagState(
  state: HashtagState | undefined,
  used: readonly string[],
): HashtagState {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const tag of [...(state?.recent ?? []), ...used].reverse()) {
    if (seen.has(tagKey(tag))) continue;
    seen.add(tagKey(tag));
    merged.push(tag);
  }
  return { current: [...used], recent: merged.slice(0, RECENT_LIMIT).reverse() };
}
