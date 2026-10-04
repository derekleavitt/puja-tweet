/**
 * Color preview and manual drop routes.
 */

import { Router } from 'express';
import type { AppDeps } from '../app.js';
import { generateColor } from '../colorEngine.js';
import { toHttpError } from '../middleware/error.js';
import { resolveTemplateText } from '../templateAgent.js';

export const createDropsRouter = ({ services, scheduler }: AppDeps) => {
  const router = Router();

  const buildPreview = async (
    contextId: string | undefined,
    template: string | undefined,
    color: any,
    slotType: string | undefined,
  ) => {
    const context = contextId
      ? services.contexts.getContext(contextId) || services.contexts.getActiveContext()
      : services.contexts.getActiveContext();
    const timeTag =
      slotType === 'morning' ? '6:00 AM' : slotType === 'evening' ? '6:00 PM' : 'Drop';
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

  router.post('/generate-color', async (req, res, next) => {
    try {
      const slotType = req.body.slotType || 'random';
      const color = req.body.color || generateColor(slotType);
      const { context, templateToUse, fields } = await buildPreview(
        req.body.contextId,
        req.body.template,
        color,
        slotType,
      );

      res.json({
        ...fields,
        contextId: context.id,
        contextName: context.name,
        hasAgentTag: /<agent>/i.test(templateToUse),
        hasHistoryTag: /<history>/i.test(templateToUse),
      });
    } catch (err) {
      next(toHttpError(err, 500));
    }
  });

  router.post('/template/preview', async (req, res, next) => {
    try {
      const { template, color, slotType, contextId } = req.body;
      const targetColor = color || generateColor(slotType || 'random');
      const { fields } = await buildPreview(contextId, template, targetColor, slotType);

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
      const result = await scheduler.executeDrop({
        contextId: req.body.contextId,
        slotType: req.body.slotType || 'manual',
        color: req.body.color,
        forceLive: req.body.forceLive === true,
        source: 'manual',
      });
      res.json(result);
    } catch (err) {
      next(toHttpError(err, 500));
    }
  });

  return router;
};
