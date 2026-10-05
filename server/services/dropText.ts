/**
 * The ONE place a drop's final text is built: template body (static + AI text) -> tag block -> 280
 * guard. Used by the preview route and by dropService, so a preview and the post can never disagree.
 * The rules (AI hashtags, seeds, length budget, placement) are documented in docs/hashtags.md.
 */

import {
  advanceHashtagState,
  dedupeHashtags,
  extractTemplateHashtags,
  findHashtags,
  fitTagBlock,
  foldAiTags,
  formatTagBlock,
  keptSeedTags,
  normaliseCampaignTags,
  normaliseEvolution,
  normaliseTags,
  parseHashtags,
  shapeAgentText,
  tagBlockLength,
  tagKey,
  type ShapedAgentText,
} from '../../shared/hashtags/index.js';
import { stripHistoryTags } from '../../shared/template/agentTags.js';
import { substituteTemplate } from '../../shared/template/substitute.js';
import {
  AGENT_TARGET_LENGTH,
  MAX_TWEET_LENGTH,
  weightedTweetLength,
} from '../../shared/tweetLength.js';
import type {
  ColorData,
  DropTextBreakdown,
  HashtagState,
  TweetContext,
} from '../../shared/types.js';
import type { resolveTemplateText } from '../templateAgent.js';
import type { HashtagService } from './hashtagService.js';

export interface ComposeOptions {
  /** Template to render instead of the saved one (editor preview of unsaved changes). */
  template?: string;
  /** Campaign hashtags to use instead of the saved ones (editor preview of unsaved changes). */
  hashtags?: string[];
  slotLabel?: string;
}

export interface ComposedText {
  text: string;
  /** Evolved tags (without '#') actually present in `text`; undefined when evolution is off. */
  hashtags?: string[];
  breakdown: DropTextBreakdown;
}

export interface ComposeDeps {
  resolveTemplateText: typeof resolveTemplateText;
  hashtags: Pick<HashtagService, 'next'>;
}

/** Told to the model whenever the app manages the tweet's hashtags. */
export const AGENT_NO_HASHTAGS_DIRECTIVE =
  'Do not write any hashtags (no #words): the app adds the hashtags itself.';
/** Never ask the model for less than this, even when the template leaves less room. */
const MIN_AGENT_LENGTH = 40;
const AGENT_BLOCK = /<agent(?:\s+history=["']?true["']?)?>[\s\S]*?<\/agent>/gi;

export const isEvolutionEnabled = (context: TweetContext): boolean =>
  normaliseEvolution(context.hashtagEvolution).enabled;

/** Body template + the campaign's own tags (unmigrated campaigns are migrated on the fly). */
export function campaignTagsFor(
  context: TweetContext,
  options: ComposeOptions = {},
): { template: string; tags: string[] } {
  const template = options.template || context.template;
  if (options.hashtags) return { template, tags: normaliseCampaignTags(options.hashtags) };
  if (context.hashtags) return { template, tags: normaliseCampaignTags(context.hashtags) };
  const moved = extractTemplateHashtags(template);
  return { template: moved.template, tags: moved.hashtags };
}

interface TagPlan {
  tags: string[];
  source: DropTextBreakdown['tagSource'];
  seedSource?: DropTextBreakdown['seedSource'];
  /** The app owns the hashtags: the model is told not to write any. */
  managed: boolean;
  kept: number;
}

async function planTags(
  deps: ComposeDeps,
  context: TweetContext,
  color: ColorData,
  template: string,
  own: string[],
): Promise<TagPlan> {
  const cfg = normaliseEvolution(context.hashtagEvolution);
  if (!cfg.enabled) {
    return {
      tags: own,
      source: own.length ? 'campaign' : 'none',
      managed: own.length > 0,
      kept: 0,
    };
  }
  const { tags } = await deps.hashtags.next(context, color, { template, hashtags: own });
  const hasPrevious = (context.hashtagState?.current ?? []).length > 0;
  return {
    tags: normaliseTags(tags),
    source: 'evolved',
    seedSource: own.length ? 'campaign' : hasPrevious ? 'previous' : 'theme',
    managed: true,
    kept: keptSeedTags(own, cfg.maxTags, cfg.keepSeedTags).length,
  };
}

/** The template's own text: variables filled in, `<agent>` blocks left out. */
const renderStatic = (template: string, color: ColorData, slotLabel?: string) =>
  substituteTemplate(stripHistoryTags(template.replace(AGENT_BLOCK, '')), color, { slotLabel });

interface AgentRun {
  texts: string[];
  shaped: ShapedAgentText[];
  droppedTail: string[];
}

/** Renders the body, reserving the tag block's room before the AI text is trimmed. */
async function renderBody(
  deps: ComposeDeps,
  context: TweetContext,
  color: ColorData,
  template: string,
  plan: TagPlan,
  slotLabel?: string,
): Promise<{ body: string; staticText: string; run: AgentRun }> {
  const staticText = renderStatic(template, color, slotLabel);
  const agents = template.match(AGENT_BLOCK)?.length ?? 0;
  const room = (reserved: number) =>
    Math.max(
      MIN_AGENT_LENGTH,
      Math.min(
        AGENT_TARGET_LENGTH,
        Math.floor(
          (MAX_TWEET_LENGTH - weightedTweetLength(staticText) - reserved) / Math.max(1, agents),
        ),
      ),
    );
  const reservedTags = parseHashtags(staticText);
  const run: AgentRun = { texts: [], shaped: [], droppedTail: [] };
  const body = await deps.resolveTemplateText(template, color, {
    slotLabel,
    contextId: context.id,
    targetTweetId: context.targetTweetId,
    agent: {
      maxLength: room(tagBlockLength(plan.tags)),
      hardMaxLength: room(0),
      directive: plan.managed ? AGENT_NO_HASHTAGS_DIRECTIVE : undefined,
      shape: (text) => shapeAgentText(text, { managed: plan.managed, reservedTags }),
      onText: ({ text, shaped, droppedTail }) => {
        run.texts.push(text);
        run.shaped.push(shaped);
        run.droppedTail.push(...droppedTail);
      },
    },
  });
  return { body, staticText: staticText.replace(/[ \t]{2,}/g, ' ').trim(), run };
}

const nonEmpty = (list: string[]) => (list.length ? list : undefined);

/** Renders the template and appends the tag block (campaign or evolved tags), trimmed to fit. */
export async function composeDropText(
  deps: ComposeDeps,
  context: TweetContext,
  color: ColorData,
  options: ComposeOptions = {},
): Promise<ComposedText> {
  const { template, tags: own } = campaignTagsFor(context, options);
  const plan = await planTags(deps, context, color, template, own);
  const { body, staticText, run } = await renderBody(
    deps,
    context,
    color,
    template,
    plan,
    options.slotLabel,
  );

  const lifted = run.shaped.flatMap((s) => s.lifted);
  let { tags, seedSource } = plan;
  let folded: string[] = [];
  if (plan.source === 'evolved' && lifted.length) {
    const blocked = [...(context.hashtagState?.recent ?? []), ...own];
    ({ tags, folded } = foldAiTags(tags, lifted, { kept: plan.kept, blocked }));
    if (folded.length && seedSource === 'theme') seedSource = 'ai';
  }

  const deduped = dedupeHashtags(body, tags);
  const fitted = fitTagBlock(deduped.text, tags);
  const present = new Set(findHashtags(fitted.text).map(tagKey));
  const posted = fitted.tags.filter((t) => present.has(tagKey(t)));
  const breakdown: DropTextBreakdown = {
    body: deduped.text.trim(),
    staticText,
    ...(run.texts.length ? { aiText: run.texts.join('\n') } : {}),
    tagBlock: formatTagBlock(posted),
    hashtags: posted,
    tagSource: posted.length ? plan.source : 'none',
    ...(seedSource ? { seedSource } : {}),
    foldedAiTags: nonEmpty(folded),
    removedAiHashtags: nonEmpty([
      ...run.shaped.flatMap((s) => [...s.lifted, ...s.removed]),
      ...run.droppedTail,
    ]),
    dehashedAiHashtags: nonEmpty(run.shaped.flatMap((s) => s.dehashed)),
    removedDuplicateTags: nonEmpty(deduped.removed),
    droppedTags: nonEmpty(tags.filter((t) => !fitted.tags.includes(t))),
  };
  for (const key of Object.keys(breakdown) as Array<keyof DropTextBreakdown>) {
    if (breakdown[key] === undefined) delete breakdown[key];
  }
  return {
    text: fitted.text,
    ...(plan.source === 'evolved' ? { hashtags: posted } : {}),
    breakdown,
  };
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
  const inText = normaliseTags(findHashtags(text));
  const present = new Set(inText.map(tagKey));
  if (claimed) return normaliseTags(claimed).filter((t) => present.has(tagKey(t)));
  return inText.slice(-normaliseEvolution(context.hashtagEvolution).maxTags);
}

/** Next stored state for a campaign after a successful post (empty `used` leaves it unchanged). */
export const nextHashtagState = (
  context: TweetContext,
  used: readonly string[],
): HashtagState | undefined =>
  used.length > 0 ? advanceHashtagState(context.hashtagState, used) : undefined;
