/**
 * Autonomous webhook / cron ping route (GET or POST for external cron/ping services).
 */

import crypto from 'crypto';
import { Router } from 'express';
import type { AppDeps } from '../app.js';
import { toHttpError } from '../middleware/error.js';

const secretsMatch = (provided: unknown, expected: string): boolean => {
  if (typeof provided !== 'string' || !expected) return false;
  const a = crypto.createHash('sha256').update(provided).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
};

export const createWebhookRouter = ({ storage, scheduler }: AppDeps) => {
  const router = Router();

  router.all(['/cron/trigger', '/webhook/trigger'], async (req, res, next) => {
    try {
      const providedSecret = req.headers['x-cron-secret'] ?? req.query.secret;

      if (!secretsMatch(providedSecret, storage.getWebhookSecret())) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized. Provide the webhook secret via x-cron-secret header or ?secret=',
        });
      }

      // Live posting is only honoured on POST; GET pings can never post live.
      const forceLive =
        req.method === 'POST' && (req.query.forceLive === 'true' || req.body?.forceLive === true);
      const slotType = (req.query.slot as any) || req.body?.slot || undefined;
      const contextId = (req.query.contextId as string) || req.body?.contextId || undefined;

      console.log(
        `[Webhook Trigger] Received autonomous ping! Executing drop... (context: ${contextId || 'active'})`,
      );
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

  // Admin routes: the secret is only ever returned here (never in /status or /settings).
  const buildUrl = (req: any) =>
    `${req.protocol}://${req.get('host')}/api/cron/trigger?secret=${encodeURIComponent(storage.getWebhookSecret())}`;

  router.get('/webhook/url', (req, res) => {
    res.json({ success: true, url: buildUrl(req) });
  });

  router.post('/settings/webhook-secret/rotate', (req, res) => {
    if (process.env.WEBHOOK_SECRET) {
      return res
        .status(409)
        .json({
          success: false,
          error: 'Secret is set via WEBHOOK_SECRET env var; change it there.',
        });
    }
    storage.rotateWebhookSecret();
    res.json({ success: true, url: buildUrl(req) });
  });

  return router;
};
