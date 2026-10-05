/**
 * Color preview and manual drop routes.
 */

import { Router } from 'express';
import type { AppDeps } from '../app.js';
import { generateColor } from '../colorEngine.js';
import { DEFAULT_ACCOUNT_ID, type ColorData } from '../../shared/types.js';
import { HttpError, toHttpError } from '../middleware/error.js';
import { normaliseTags } from '../../shared/hashtags/index.js';
import { formatTimeInZone } from '../../shared/time.js';
import type { ExecuteDropOptions } from '../services/dropService.js';

/** The conversation turn a preview returned, echoed by post-now; anything else is a 400. */
const parseConversationEcho = (raw: unknown): ExecuteDropOptions['conversation'] => {
  if (raw === undefined || raw === null) return undefined;
  const c = raw as Record<string, unknown>;
  if (
    typeof c !== 'object' ||
    typeof c.runId !== 'string' ||
    typeof c.turnNumber !== 'number' ||
    typeof c.speakerAccountId !== 'string' ||
    typeof c.nextSpeakerAccountId !== 'string'
  ) {
    throw new HttpError(400, 'conversation must be the turn object returned by the preview');
  }
  return {
    runId: c.runId,
    turnNumber: c.turnNumber,
    speakerAccountId: c.speakerAccountId,
    nextSpeakerAccountId: c.nextSpeakerAccountId,
  };
};

export const createDropsRouter = ({ services, drops }: AppDeps) => {
  const router = Router();

  /** Unknown ids are a 404 (never a silent fallback); no id means the active context. */
  const resolveContext = (contextId: unknown) => {
    if (contextId === undefined || contextId === null || contextId === '') {
      return services.contexts.getActiveContext();
    }
    const found =
      typeof contextId === 'string' ? services.contexts.getContext(contextId) : undefined;
    if (!found) throw new HttpError(404, `Context ${String(contextId)} not found`);
    return found;
  };

  const buildPreview = async (
    contextId: string | undefined,
    template: string | undefined,
    color: ColorData,
    campaignTags: string[] | undefined,
  ) => {
    const context = resolveContext(contextId);
    const timeTag = formatTimeInZone(new Date(), context.schedule?.timezone);
    const templateToUse = template || context.template;

    const {
      text: previewText,
      hashtags,
      breakdown,
    } = await drops.composeText(context, color, {
      template: template || undefined,
      hashtags: campaignTags,
      slotLabel: timeTag,
    });
    const replyInfo = services.contexts.getEffectiveReplyTargetId(context);

    return {
      context,
      templateToUse,
      fields: {
        color,
        previewText,
        // Evolved tags the preview used; post-now takes them back so the post does not re-roll.
        ...(hashtags ? { hashtags } : {}),
        // How the text was put together (body, tag block, AI tag clean-up), for the UI to explain.
        breakdown,
        charCount: previewText.length,
        targetTweetId: context.targetTweetId,
        // The account the post goes out as (default account when the campaign has none).
        accountId: context.accountId || DEFAULT_ACCOUNT_ID,
        accountHandle: services.accounts.handleOf(context.accountId) ?? '',
        replyToTweetId: replyInfo.targetTweetId,
        replyTargetMode: context.replyTargetMode || 'original_post',
        lastPostedTweetId: context.lastPostedTweetId,
        isCascadingToLastComment: replyInfo.isCascadingToLastComment,
        isFirstInChain: replyInfo.isFirstInChain,
      },
    };
  };

  /** Color only: never resolves the template, so it can never call Gemini. */
  router.post('/generate-color', (req, res, next) => {
    try {
      resolveContext(req.body?.contextId);
      res.json({ color: req.body?.color || generateColor(req.body?.slotType || 'random') });
    } catch (err) {
      next(toHttpError(err, 500));
    }
  });

  router.post('/template/preview', async (req, res, next) => {
    try {
      const { template, color, slotType, contextId, hashtags } = req.body;
      if (
        hashtags !== undefined &&
        (!Array.isArray(hashtags) || hashtags.some((t: unknown) => typeof t !== 'string'))
      ) {
        throw new HttpError(400, 'hashtags must be an array of strings');
      }
      const target = resolveContext(contextId);
      if (target.mode === 'conversation') {
        // The turn is written once here; Post sends it back (with `conversation`) unchanged.
        const turn = await drops.buildTurn(target);
        const replyInfo = services.contexts.getEffectiveReplyTargetId(target);
        res.json({
          success: true,
          previewText: turn.text,
          charCount: turn.text.length,
          replyToTweetId: turn.replyToTweetId,
          lastPostedTweetId: target.lastPostedTweetId,
          isFirstInChain: replyInfo.isFirstInChain,
          accountId: turn.speakerAccountId,
          accountHandle: turn.speakerHandle,
          conversation: {
            runId: turn.runId,
            turnNumber: turn.turnNumber,
            speakerAccountId: turn.speakerAccountId,
            speakerHandle: turn.speakerHandle,
            nextSpeakerAccountId: turn.nextSpeakerAccountId,
            nextSpeakerHandle: turn.nextSpeakerHandle,
            summaryUsed: turn.summaryUsed,
            transcriptLength: turn.transcriptLength,
          },
        });
        return;
      }
      const targetColor = color || generateColor(slotType || 'random');
      const { fields } = await buildPreview(contextId, template, targetColor, hashtags);

      res.json({
        success: true,
        ...fields,
        hasAgentTag: /<agent>/i.test(template || ''),
        hasHistoryTag: /<history>/i.test(template || ''),
      });
    } catch (err) {
      next(toHttpError(err, 500));
    }
  });

  router.post('/post-now', async (req, res, next) => {
    try {
      const { text, slotId, hashtags, conversation } = req.body;
      if (text !== undefined && typeof text !== 'string') {
        throw new HttpError(400, 'text must be a string');
      }
      const result = await drops.executeDrop({
        contextId: req.body.contextId,
        slotType: req.body.slotType || 'manual',
        color: req.body.color,
        forceLive: req.body.forceLive === true,
        text,
        conversation: parseConversationEcho(conversation),
        hashtags:
          text !== undefined && Array.isArray(hashtags) ? normaliseTags(hashtags) : undefined,
        source: 'manual',
      });
      // A sent queue slot is consumed on success or simulation (never on failure).
      if (result.success && typeof slotId === 'string') {
        services.queue.consumeQueueSlot(slotId, result.context.id);
      }
      res.json(result);
    } catch (err) {
      next(toHttpError(err, 500));
    }
  });

  return router;
};
