/**
 * Tweet context (campaign) management routes.
 * Unknown `:id` values are rejected with 404 before any handler runs.
 */

import { Router } from 'express';
import type { AppDeps } from '../app.js';
import { HttpError, toHttpError } from '../middleware/error.js';

export const createContextsRouter = ({ storage, scheduler }: AppDeps) => {
  const router = Router();

  router.param('id', (_req, _res, next, id) => {
    if (!storage.getContext(id)) {
      return next(new HttpError(404, `Context ${id} not found`));
    }
    next();
  });

  router.get('/contexts', (_req, res) => {
    res.json({
      contexts: storage.getContexts(),
      activeContextId: storage.getActiveContext().id,
      nextPosts: scheduler.getAllNextScheduledPosts(),
    });
  });

  router.post('/contexts', (req, res, next) => {
    try {
      const created = storage.createContext(req.body);
      res.json({
        success: true,
        context: created,
        contexts: storage.getContexts(),
        queue: storage.getQueue(),
      });
    } catch (err) {
      next(toHttpError(err, 400));
    }
  });

  router.put('/contexts/:id', (req, res, next) => {
    try {
      const updated = storage.updateContext(req.params.id, req.body);
      res.json({
        success: true,
        context: updated,
        contexts: storage.getContexts(),
        queue: storage.getQueue(),
      });
    } catch (err) {
      next(toHttpError(err, 400));
    }
  });

  router.delete('/contexts/:id', (req, res, next) => {
    try {
      const ok = storage.deleteContext(req.params.id);
      res.json({
        success: ok,
        contexts: storage.getContexts(),
        activeContextId: storage.getActiveContext().id,
        queue: storage.getQueue(),
      });
    } catch (err) {
      next(toHttpError(err, 400));
    }
  });

  router.post('/contexts/:id/activate', (req, res, next) => {
    try {
      const active = storage.setActiveContextId(req.params.id);
      res.json({
        success: true,
        activeContext: active,
        contexts: storage.getContexts(),
        queue: storage.getQueue(active.id),
      });
    } catch (err) {
      next(toHttpError(err, 400));
    }
  });

  router.post('/contexts/:id/toggle', (req, res, next) => {
    try {
      const toggled = storage.toggleContext(req.params.id);
      res.json({
        success: true,
        context: toggled,
        contexts: storage.getContexts(),
        queue: storage.getQueue(),
      });
    } catch (err) {
      next(toHttpError(err, 400));
    }
  });

  router.post('/contexts/:id/duplicate', (req, res, next) => {
    try {
      const duplicated = storage.duplicateContext(req.params.id);
      res.json({
        success: true,
        context: duplicated,
        contexts: storage.getContexts(),
        queue: storage.getQueue(),
      });
    } catch (err) {
      next(toHttpError(err, 400));
    }
  });

  router.post('/contexts/:id/reset-chain', (req, res, next) => {
    try {
      const updated = storage.resetContextChain(req.params.id);
      res.json({
        success: true,
        context: updated,
        contexts: storage.getContexts(),
        queue: storage.getQueue(),
      });
    } catch (err) {
      next(toHttpError(err, 400));
    }
  });

  router.post('/contexts/:id/clear-history', (req, res, next) => {
    try {
      const result = storage.clearContextHistory(req.params.id);
      res.json({
        success: true,
        clearedCount: result.clearedCount,
        context: result.context,
        contexts: storage.getContexts(),
        logs: storage.getLogs(),
        queue: storage.getQueue(),
      });
    } catch (err) {
      next(toHttpError(err, 400));
    }
  });

  router.post('/contexts/:id/trigger', async (req, res, next) => {
    try {
      const result = await scheduler.executeDrop({
        contextId: req.params.id,
        slotType: req.body.slotType || 'manual',
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
