/**
 * What is trending on X right now, as hashtags (GET /2/trends/by/woeid/:woeid, app-only bearer).
 * Used to steer evolving hashtags of conversation campaigns toward tags people are reading.
 *
 * Off unless X_TRENDS_WOEID is set (1 = worldwide, 23424977 = United States): the endpoint needs an
 * X plan with trends access (Pro, or pay-per-use at about $0.01 a call). Results are cached for an
 * hour; a refusal (no access on the plan, bad token) switches it off for a day. It never throws:
 * no trends just means none are offered.
 */

import { normaliseTag } from '../../shared/hashtags/index.js';
import { getXTimeoutMs } from '../timeouts.js';

export const TRENDS_CACHE_MS = 60 * 60 * 1000;
export const TRENDS_REFUSED_MS = 24 * 60 * 60 * 1000;
const MAX_TRENDS = 20;

export interface TrendDeps {
  /** X_TRENDS_WOEID; blank = trends off. */
  woeid: () => string | undefined;
  bearerToken: () => string | undefined;
  fetch: typeof fetch;
  now: () => number;
}

/** Trend names as tags (without '#'): "#Coffee" -> "Coffee", "World Cup" -> "WorldCup". */
export function trendTags(body: unknown): string[] {
  const data = (body as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];
  const tags: string[] = [];
  for (const item of data) {
    const name = (item as { trend_name?: unknown })?.trend_name;
    if (typeof name !== 'string') continue;
    const tag = normaliseTag(name.replace(/^\uFF03/, '#'));
    if (tag && !tags.some((t) => t.toLowerCase() === tag.toLowerCase())) tags.push(tag);
    if (tags.length === MAX_TRENDS) break;
  }
  return tags;
}

export const createTrendService = (overrides: Partial<TrendDeps> = {}) => {
  const deps: TrendDeps = {
    woeid: () => process.env.X_TRENDS_WOEID?.trim() || undefined,
    bearerToken: () => process.env.TWITTER_BEARER_TOKEN?.trim() || undefined,
    fetch: (...args) => fetch(...args),
    now: () => Date.now(),
    ...overrides,
  };
  let cache: { at: number; tags: string[] } | undefined;
  let refusedUntil = 0;

  const getTrendingHashtags = async (): Promise<string[]> => {
    const woeid = deps.woeid();
    const token = deps.bearerToken();
    if (!woeid || !token) return [];
    const now = deps.now();
    if (now < refusedUntil) return [];
    if (cache && now - cache.at < TRENDS_CACHE_MS) return cache.tags;
    try {
      const res = await deps.fetch(
        `https://api.x.com/2/trends/by/woeid/${encodeURIComponent(woeid)}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(getXTimeoutMs()),
        },
      );
      if ([401, 402, 403].includes(res.status)) {
        refusedUntil = now + TRENDS_REFUSED_MS;
        console.warn(
          `[Trends] X refused trends (HTTP ${res.status}); the X plan may not include them. ` +
            'Retrying in 24 h.',
        );
        return [];
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const tags = trendTags(await res.json());
      cache = { at: now, tags };
      return tags;
    } catch (err) {
      console.warn('[Trends] Could not read X trends:', err instanceof Error ? err.message : err);
      // Keep serving the last good list for a while rather than calling again on every turn.
      if (cache) cache = { ...cache, at: now };
      return cache?.tags ?? [];
    }
  };

  return { getTrendingHashtags };
};

export type TrendService = ReturnType<typeof createTrendService>;

export const trendService: TrendService = createTrendService();
