/**
 * Legacy settings routes: the global switches plus ONE campaign's fields.
 * The body may carry `contextId` (the campaign the form was opened for); without it the active
 * campaign is edited, which is only safe when the client cannot have switched campaigns meanwhile.
 */

import { Router } from 'express';
import type { AppDeps } from '../app.js';
import { toHttpError } from '../middleware/error.js';

export const createSettingsRouter = ({ services }: AppDeps) => {
  const router = Router();

  router.post('/settings', (req, res, next) => {
    try {
      const updated = services.settings.updateSettings(req.body ?? {});
      const edited = services.contexts.getContext(updated.activeContextId ?? '');
      res.json({
        success: true,
        settings: updated,
        activeContext: services.contexts.getActiveContext(),
        /** The campaign the body was applied to (same as `activeContext` without `contextId`). */
        context: edited,
        contexts: services.contexts.getContexts(),
        queue: services.queue.getQueue(edited?.id),
      });
    } catch (err) {
      next(toHttpError(err, 400));
    }
  });

  return router;
};
