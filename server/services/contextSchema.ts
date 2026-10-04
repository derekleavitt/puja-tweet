/**
 * Client-editable context fields. Anything not listed here (stats, consecutiveErrors,
 * timestamps, createdAt, id, ...) is stripped and can never be written through the API.
 */

import { z } from 'zod';
import { HttpError } from '../middleware/error.js';
import { extractTweetId } from '../../shared/tweetId.js';
import type { TweetContext } from '../../shared/types.js';

const scheduleSchema = z.object({
  mode: z.enum(['interval', 'fixed_times']).optional(),
  intervalMinutes: z.number().optional(),
  scheduleTimes: z.array(z.string()).optional(),
  timezone: z.string().optional(),
  humanizeJitterEnabled: z.boolean().optional(),
  jitterPercentage: z.number().optional(),
});

export const contextUpdateSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
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
  lastPostedTweetId: z.string().nullish(),
});

export type ContextUpdateInput = Partial<
  Pick<
    TweetContext,
    | 'name'
    | 'description'
    | 'targetTweetId'
    | 'replyTargetMode'
    | 'engagementMode'
    | 'autoFallbackToQuote'
    | 'enabled'
    | 'dryRun'
    | 'template'
    | 'themePreference'
    | 'lastPostedTweetId'
  >
> & { schedule?: Partial<TweetContext['schedule']> };

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
  const { lastPostedTweetId, ...rest } = result.data;
  const parsed: ContextUpdateInput = { ...rest };
  // Keep "key present" semantics: an explicit null/'' clears the chain anchor.
  if (lastPostedTweetId !== undefined) parsed.lastPostedTweetId = lastPostedTweetId ?? undefined;
  return parsed;
};

/** Validates a client create body (same whitelist as updates). */
export const parseContextCreate = parseContextUpdate;
