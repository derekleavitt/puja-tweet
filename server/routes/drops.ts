/**
 * Color preview and manual drop routes.
 */

import { Router } from 'express';
import type { AppDeps } from '../app.js';
import { generateColor } from '../colorEngine.js';
import type { ColorData } from '../../shared/types.js';
import { HttpError, toHttpError } from '../middleware/error.js';
import { resolveTemplateText } from '../templateAgent.js';
import { formatTimeInZone } from '../../shared/time.js';

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
  ) => {
    const context = resolveContext(contextId);
    const timeTag = formatTimeInZone(new Date(), context.schedule?.timezone);
    const templateToUse = template || context.template;

    const previewText = await resolveTemplateText(templateToUse, color, {
      slotLabel: timeTag,
      contextId: context.id,
      targetTweetId: context.targetTweetId,
    });
    const replyInfo = services.contexts.getEffectiveReplyTargetId(context);

    return {
      context,
      templateToUse,
      fields: {
        color,
        previewText,
        charCount: previewText.length,
        targetTweetId: context.targetTweetId,
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
      const { template, color, slotType, contextId } = req.body;
      const targetColor = color || generateColor(slotType || 'random');
      const { fields } = await buildPreview(contextId, template, targetColor);

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
      const { text, slotId } = req.body;
      if (text !== undefined && typeof text !== 'string') {
        throw new HttpError(400, 'text must be a string');
      }
      const result = await drops.executeDrop({
        contextId: req.body.contextId,
        slotType: req.body.slotType || 'manual',
        color: req.body.color,
        forceLive: req.body.forceLive === true,
        text,
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
