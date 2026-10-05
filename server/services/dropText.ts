/**
 * The ONE place a drop's final text is built (template -> evolved hashtags -> 280 guard).
 * Used by the preview route and by dropService, so a preview and the post can never disagree.
 */

import {
  advanceHashtagState,
  fitHashtags,
  getSeedTags,
  normaliseEvolution,
  normaliseTags,
  parseHashtags,
  tagKey,
} from '../../shared/hashtags/index.js';
import type { ColorData, HashtagState, TweetContext } from '../../shared/types.js';
import type { resolveTemplateText } from '../templateAgent.js';
import type { HashtagService } from './hashtagService.js';

export interface ComposeOptions {
  /** Template to render instead of the saved one (editor preview of unsaved changes). */
  template?: string;
  slotLabel?: string;
}

export interface ComposedText {
  text: string;
  /** Evolved tags (without '#') actually present in `text`; undefined when evolution is off. */
  hashtags?: string[];
}

export interface ComposeDeps {
  resolveTemplateText: typeof resolveTemplateText;
  hashtags: Pick<HashtagService, 'next'>;
}

export const isEvolutionEnabled = (context: TweetContext): boolean =>
  normaliseEvolution(context.hashtagEvolution).enabled;

/** Renders the template and, when the campaign evolves hashtags, swaps them in (trimmed to fit). */
export async function composeDropText(
  deps: ComposeDeps,
  context: TweetContext,
  color: ColorData,
  options: ComposeOptions = {},
): Promise<ComposedText> {
  const template = options.template || context.template;
  const text = await deps.resolveTemplateText(template, color, {
    slotLabel: options.slotLabel,
    contextId: context.id,
    targetTweetId: context.targetTweetId,
  });
  if (!isEvolutionEnabled(context)) return { text };

  const { found } = getSeedTags(template);
  const { tags } = await deps.hashtags.next(context, color, { template });
  const fitted = fitHashtags(text, found, tags);
  return { text: fitted.text, hashtags: fitted.tags };
}

/**
 * Tags to remember after a successful post of `text`: the ones the preview reported (`claimed`),
 * or any hashtags found in the text, limited to tags that really are in it.
 */
export function usedHashtags(
  context: TweetContext,
  text: string,
  claimed?: readonly string[],
): string[] {
  const inText = parseHashtags(text);
  const present = new Set(inText.map(tagKey));
  if (claimed) return normaliseTags(claimed).filter((t) => present.has(tagKey(t)));
  return inText.slice(0, normaliseEvolution(context.hashtagEvolution).maxTags);
}

/** Next stored state for a campaign after a successful post (empty `used` leaves it unchanged). */
export const nextHashtagState = (
  context: TweetContext,
  used: readonly string[],
): HashtagState | undefined =>
  used.length > 0 ? advanceHashtagState(context.hashtagState, used) : undefined;
