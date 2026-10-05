/**
 * Client-editable context fields. Anything not listed here (stats, consecutiveErrors,
 * timestamps, createdAt, id, ...) is stripped and can never be written through the API.
 */

import { z } from 'zod';
import { HttpError } from '../middleware/error.js';
import { extractTweetId } from '../../shared/tweetId.js';
import type { HashtagEvolutionConfig, TweetContext } from '../../shared/types.js';

const scheduleSchema = z.object({
  mode: z.enum(['interval', 'fixed_times']).optional(),
  intervalMinutes: z.number().optional(),
  scheduleTimes: z.array(z.string()).optional(),
  timezone: z.string().optional(),
  humanizeJitterEnabled: z.boolean().optional(),
  jitterPercentage: z.number().optional(),
});

const hashtagEvolutionSchema = z.object({
  enabled: z.boolean().optional(),
  maxTags: z.number().int().min(1).max(5).optional(),
  keepSeedTags: z.boolean().optional(),
});

export const contextUpdateSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  // X account the campaign posts as ('' / null / 'acct_env' = the default account). Must exist.
  accountId: z.string().max(100).nullish(),
  targetTweetId: z
    .string()
    .refine(
      (v) => !v.trim() || extractTweetId(v) !== null,
      'targetTweetId must be a tweet ID or a tweet URL',
    )
    .optional(),
  replyTargetMode: z.enum(['original_post', 'last_comment']).optional(),
  engagementMode: z.enum(['reply', 'quote', 'standalone']).optional(),
  autoFallbackToQuote: z.boolean().optional(),
  enabled: z.boolean().optional(),
  dryRun: z.boolean().optional(),
  schedule: scheduleSchema.optional(),
  template: z.string().optional(),
  themePreference: z.enum(['dynamic', 'vibrant', 'minimal', 'poetic']).optional(),
  // Accepted only as an explicit reset (null / ''); a string value is ignored (the anchor is
  // server-owned, see `ContextService.updateContext`), so an edit form echoing it is harmless.
  lastPostedTweetId: z.string().nullish(),
  // The campaign's own hashtags (normalised and capped at 10 by the service).
  hashtags: z.array(z.string().max(100)).max(50).optional(),
  // Config only: `hashtagState` is server-owned and stripped from client bodies.
  hashtagEvolution: hashtagEvolutionSchema.optional(),
});

export type ContextUpdateInput = Partial<
  Pick<
    TweetContext,
    | 'name'
    | 'description'
    | 'accountId'
    | 'targetTweetId'
    | 'replyTargetMode'
    | 'engagementMode'
    | 'autoFallbackToQuote'
    | 'enabled'
    | 'dryRun'
    | 'template'
    | 'themePreference'
    | 'lastPostedTweetId'
    | 'hashtags'
  >
> & {
  schedule?: Partial<TweetContext['schedule']>;
  hashtagEvolution?: Partial<HashtagEvolutionConfig>;
};

/**
 * Validates a client create/update body; throws HttpError(400) on bad input and strips unknown keys.
 * Create and update share one whitelist so neither can write server-owned fields.
 */
export const parseContextUpdate = (body: unknown): ContextUpdateInput => {
  const result = contextUpdateSchema.safeParse(body ?? {});
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue.path.length ? `${issue.path.join('.')}: ` : '';
    throw new HttpError(400, `${where}${issue.message}`);
  }
  const { lastPostedTweetId, accountId, ...rest } = result.data;
  const parsed: ContextUpdateInput = { ...rest };
  if (accountId !== undefined) parsed.accountId = accountId ?? '';
  // Keep "key present" semantics: an explicit null/'' clears the chain anchor.
  if (lastPostedTweetId !== undefined) parsed.lastPostedTweetId = lastPostedTweetId ?? undefined;
  return parsed;
};

/** Validates a client create body (same whitelist as updates). */
export const parseContextCreate = parseContextUpdate;
