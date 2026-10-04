/**
 * Autonomous webhook / cron ping route (GET or POST for external cron/ping services).
 */

import { Router } from 'express';
import type { AppDeps } from '../app.js';
import { toHttpError } from '../middleware/error.js';

export const createWebhookRouter = ({ storage, scheduler }: AppDeps) => {
  const router = Router();

  router.all(['/cron/trigger', '/webhook/trigger'], async (req, res, next) => {
    try {
      const settings = storage.getSettings();
      const providedSecret = req.query.secret || req.headers['x-cron-secret'] || req.body?.secret;

      if (settings.webhookSecret && providedSecret !== settings.webhookSecret) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized. Invalid secret parameter (?secret=YOUR_SECRET)',
        });
      }

      const forceLive = req.query.forceLive === 'true' || req.body?.forceLive === true;
      const slotType = (req.query.slot as any) || req.body?.slot || undefined;
      const contextId = (req.query.contextId as string) || req.body?.contextId || undefined;

      console.log(`[Webhook Trigger] Received autonomous ping! Executing drop... (context: ${contextId || 'active'})`);
      const result = await scheduler.executeDrop({
        contextId,
        slotType,
        forceLive,
        source: 'webhook',
      });

      res.json({
        message: 'Autonomous drop executed successfully!',
        ...result,
      });
    } catch (err) {
      next(toHttpError(err, 500));
    }
  });

  return router;
};
