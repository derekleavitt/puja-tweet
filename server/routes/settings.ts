/**
 * Global bot settings routes.
 */

import { Router } from 'express';
import type { AppDeps } from '../app.js';
import { toHttpError } from '../middleware/error.js';

export const createSettingsRouter = ({ services }: AppDeps) => {
  const router = Router();

  router.post('/settings', (req, res, next) => {
    try {
      const updated = services.settings.updateSettings(req.body);
      res.json({
        success: true,
        settings: updated,
        activeContext: services.contexts.getActiveContext(),
        contexts: services.contexts.getContexts(),
        queue: services.queue.getQueue(),
      });
    } catch (err) {
      next(toHttpError(err, 400));
    }
  });

  return router;
};
