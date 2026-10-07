/**
 * Evolving hashtags: picks the next tag set for a campaign.
 * Uses Gemini when configured and the daily cap allows, and falls back to the offline generator on
 * ANY problem (timeout, error, cap reached, empty or invalid output). It never throws, so a drop
 * is never blocked on Gemini. It does not touch campaign state; dropService advances that after a
 * successful post.
 */

import {
  clampMaxTags,
  evolveOffline,
  getSeedTags,
  keptSeedTags,
  normaliseEvolution,
  normaliseCampaignTags,
  normaliseTag,
  normaliseTags,
  tagKey,
  themeSeedTags,
} from '../../shared/hashtags/index.js';
import { templateUsesColor } from '../../shared/template/colorTokens.js';
import type { ColorData, TweetContext } from '../../shared/types.js';
import { errorMessage } from '../errorMessage.js';
import { getGeminiClient } from '../geminiClient.js';
import { getGeminiModels, isGeminiConfigured, tryConsumeGeminiCall } from '../geminiConfig.js';
import { getGeminiTimeoutMs } from '../timeouts.js';
import { trendService } from './trendService.js';

export interface HashtagDeps {
  isConfigured: () => boolean;
  /** Reserves one call against GEMINI_MAX_CALLS_PER_DAY; false = cap reached. */
  tryConsume: () => boolean;
  /** Sends the prompt to the model and returns its raw text (must honour the Gemini timeout). */
  generate: (prompt: string, systemInstruction?: string) => Promise<string>;
  /** Hashtags trending on X right now ([] when unavailable); offered to conversations only. */
  trending: () => Promise<string[]>;
  rng?: () => number;
}

export interface NextHashtags {
  /** Tags without '#', ready for `fitHashtags`. */
  tags: string[];
  source: 'gemini' | 'offline';
}

export const HASHTAG_SYSTEM_INSTRUCTION =
  'You suggest hashtags for a creative X account (color drops, short verse, character conversations). ' +
  'Be tasteful and non-spammy: ' +
  'no engagement bait, no trending-topic piggybacking. Reply with ONLY a JSON array of strings.';

/** Conversations: tags that help people find the thread, so popular ones over clever ones. */
export const CONVERSATION_HASHTAG_SYSTEM_INSTRUCTION =
  'You pick hashtags that help real people find a public X (Twitter) conversation: popular, widely ' +
  'followed and searched tags that fit its subject, the ones people actually read. Prefer established ' +
  'tags over invented or overly specific ones. Never use a trending tag that does not fit the subject. ' +
  'Reply with ONLY a JSON array of strings.';

/** How many of a conversation's latest tag sets are not repeated: popular tags may come back. */
const CONVERSATION_NO_REPEAT_SETS = 2;

const asTags = (tags: readonly string[]) => tags.map((t) => `#${t}`).join(' ');

/** Default Gemini call: primary model, the shared timeout, low-ish temperature for tidy output. */
export const generateWithGemini = async (
  prompt: string,
  systemInstruction = HASHTAG_SYSTEM_INSTRUCTION,
): Promise<string> => {
  const response = await getGeminiClient().models.generateContent({
    model: getGeminiModels()[0],
    contents: prompt,
    config: {
      systemInstruction,
      temperature: 0.8,
      abortSignal: AbortSignal.timeout(getGeminiTimeoutMs()),
    },
  });
  return response.text ?? '';
};

export const buildHashtagPrompt = (
  previous: readonly string[],
  count: number,
  recent: readonly string[],
  colorName?: string,
): string =>
  `Given these hashtags: ${asTags(previous)}, suggest ${count} new related, tasteful, non-spammy ` +
  `hashtags${colorName ? ` (today's color is "${colorName}")` : ''}, no repeats of: ` +
  `${recent.length ? asTags(recent) : '(none)'}. ` +
  'Each hashtag is one word or CamelCase, 2-30 letters, without spaces. ' +
  'Reply as a JSON array of strings, e.g. ["Example","AnotherOne"].';

/**
 * Conversation prompt: popular tags for what is being talked about, moving on from the last set,
 * and picking from what is trending on X right now only when it fits.
 */
export const buildConversationHashtagPrompt = (
  previous: readonly string[],
  count: number,
  avoid: readonly string[],
  topic: string,
  trending: readonly string[] = [],
): string =>
  `A public X conversation is about: "${topic}". Suggest ${count} hashtags people on X actually ` +
  'follow and search for this subject: popular, established tags (e.g. #Coffee, #FlyFishing), not ' +
  `invented or overly specific ones. Move on from the last ones used: ${asTags(previous)}. ` +
  `Do not repeat: ${avoid.length ? asTags(avoid) : '(none)'}. ` +
  (trending.length
    ? `Trending on X right now: ${asTags(trending)}. Use one of these only if it truly fits the subject. `
    : '') +
  'Each hashtag is one word or CamelCase, 2-30 letters, without spaces. ' +
  'Reply as a JSON array of strings, e.g. ["Example","AnotherOne"].';

/** Parses a model reply (bare or fenced JSON array) into normalised tags; [] when unusable. */
export function parseHashtagReply(raw: string): string[] {
  const text = raw.replace(/```[a-z]*/gi, '').trim();
  const json = text.startsWith('[') ? text : (text.match(/\[[\s\S]*\]/)?.[0] ?? '');
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return normaliseTags(parsed.filter((x): x is string => typeof x === 'string'));
  } catch {
    return [];
  }
}

const defaultDeps = (): HashtagDeps => ({
  isConfigured: () => isGeminiConfigured(),
  tryConsume: () => tryConsumeGeminiCall(),
  generate: generateWithGemini,
  trending: () => trendService.getTrendingHashtags(),
});

export const createHashtagService = (overrides: Partial<HashtagDeps> = {}) => {
  const deps: HashtagDeps = { ...defaultDeps(), ...overrides };

  const fromGemini = async (
    previous: string[],
    slots: number,
    blocked: Set<string>,
    colorName: string | undefined,
    recent: readonly string[],
    topic?: string,
  ): Promise<string[]> => {
    if (!deps.isConfigured() || !deps.tryConsume()) return [];
    try {
      const reply = topic
        ? await deps.generate(
            buildConversationHashtagPrompt(previous, slots, recent, topic, await deps.trending()),
            CONVERSATION_HASHTAG_SYSTEM_INSTRUCTION,
          )
        : await deps.generate(buildHashtagPrompt(previous, slots, recent, colorName));
      return parseHashtagReply(reply)
        .filter((t) => !blocked.has(tagKey(t)))
        .slice(0, slots);
    } catch (err) {
      console.warn('[Hashtags] Gemini unavailable, using offline generator:', errorMessage(err));
      return [];
    }
  };

  /**
   * Next tags for `context` and today's `color`. Seed = the campaign's own `hashtags` (override with
   * `opts.hashtags`), else the previous evolved tags, else a theme (`themeSeedTags`). The color name
   * is only offered for templates that use color tokens. Conversations pass `topic` (premise and
   * latest turn) instead of a template and color: the tags follow what is being talked about.
   */
  const next = async (
    context: TweetContext,
    color: ColorData | undefined,
    opts: { template?: string; hashtags?: string[]; topic?: string } = {},
  ): Promise<NextHashtags> => {
    const cfg = normaliseEvolution(context.hashtagEvolution);
    const max = clampMaxTags(cfg.maxTags);
    const template = opts.topic ?? opts.template ?? context.template;
    const own = opts.hashtags ?? context.hashtags;
    const base = own ? normaliseCampaignTags(own) : getSeedTags(template).found; // unmigrated
    const seed = base.length ? base : themeSeedTags(template);
    const current = context.hashtagState?.current ?? [];
    const previous = current.length > 0 ? current : seed;
    const allRecent = context.hashtagState?.recent ?? [];
    // Conversations aim for popular tags, a small set: only the last two sets are off limits.
    const recent = opts.topic ? allRecent.slice(-CONVERSATION_NO_REPEAT_SETS * max) : allRecent;
    const name = color ? color.colorPick || color.name : '';
    const colorName = templateUsesColor(template) && normaliseTag(name) ? name : undefined;

    const kept = keptSeedTags(base, max, cfg.keepSeedTags);
    const slots = max - kept.length;
    // A conversation may come back to its (popular) seed tags; color drops always move on.
    const blocked = new Set([...recent, ...(opts.topic ? [] : seed), ...kept].map(tagKey));
    const generated = await fromGemini(previous, slots, blocked, colorName, recent, opts.topic);
    if (generated.length > 0) return { tags: [...kept, ...generated], source: 'gemini' };

    const tags = evolveOffline(previous, {
      recent,
      colorName,
      maxTags: max,
      // A theme seed is a starting point only: "keep" applies to the campaign's own tags.
      keepSeedTags: cfg.keepSeedTags && base.length > 0,
      seed,
      rng: deps.rng,
    });
    return { tags, source: 'offline' };
  };

  return { next };
};

export type HashtagService = ReturnType<typeof createHashtagService>;

export const hashtagService: HashtagService = createHashtagService();
