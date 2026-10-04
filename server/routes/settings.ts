/**
 * Global bot settings routes.
 */

import { Router } from 'express';
import type { AppDeps } from '../app.js';
import { toHttpError } from '../middleware/error.js';

export const createSettingsRouter = ({ storage }: AppDeps) => {
  const router = Router();

  router.post('/settings', (req, res, next) => {
    try {
      const updated = storage.updateSettings(req.body);
      res.json({
        success: true,
        settings: updated,
        activeContext: storage.getActiveContext(),
        contexts: storage.getContexts(),
        queue: storage.getQueue(),
      });
    } catch (err) {
      next(toHttpError(err, 400));
    }
  });

  return router;
};
