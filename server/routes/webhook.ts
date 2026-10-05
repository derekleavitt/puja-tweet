/**
 * Autonomous webhook / cron ping route (GET or POST for external cron/ping services).
 */

import { Router, type Request } from 'express';
import type { AppDeps } from '../app.js';
import { HttpError, toHttpError } from '../middleware/error.js';
import { secretsMatch } from '../middleware/secret.js';

export const createWebhookRouter = ({ services, drops }: AppDeps) => {
  const router = Router();

  router.all(['/cron/trigger', '/webhook/trigger'], async (req, res, next) => {
    try {
      const providedSecret = req.headers['x-cron-secret'] ?? req.query.secret;

      if (!secretsMatch(providedSecret, services.credentials.getWebhookSecret())) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized. Provide the webhook secret via x-cron-secret header or ?secret=',
        });
      }

      // Live posting is only honoured on POST; GET pings can never post live.
      const forceLive =
        req.method === 'POST' && (req.query.forceLive === 'true' || req.body?.forceLive === true);
      const slot = req.query.slot ?? req.body?.slot;
      const slotType =
        slot === 'morning' || slot === 'evening' || slot === 'manual' ? slot : undefined;
      const contextId = (req.query.contextId as string) || req.body?.contextId || undefined;

      console.log(
        `[Webhook Trigger] Received autonomous ping! Executing drop... (context: ${contextId || 'active'})`,
      );
      const result = await drops.executeDrop({
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
  // With `?contextId=` the URL pins the campaign, so an external cron can never post "whatever
  // campaign happens to be active in the UI" (404 for an unknown id).
  const buildUrl = (req: Request, contextId?: string) => {
    const secret = encodeURIComponent(services.credentials.getWebhookSecret());
    const pin = contextId ? `&contextId=${encodeURIComponent(contextId)}` : '';
    return `${req.protocol}://${req.get('host')}/api/cron/trigger?secret=${secret}${pin}`;
  };

  router.get('/webhook/url', (req, res, next) => {
    const contextId = typeof req.query.contextId === 'string' ? req.query.contextId : undefined;
    if (contextId && !services.contexts.getContext(contextId)) {
      return next(new HttpError(404, `Context ${contextId} not found`));
    }
    res.json({ success: true, url: buildUrl(req, contextId) });
  });

  router.post('/settings/webhook-secret/rotate', (req, res) => {
    if (process.env.WEBHOOK_SECRET) {
      return res.status(409).json({
        success: false,
        error: 'Secret is set via WEBHOOK_SECRET env var; change it there.',
      });
    }
    services.credentials.rotateWebhookSecret();
    res.json({ success: true, url: buildUrl(req) });
  });

  return router;
};
