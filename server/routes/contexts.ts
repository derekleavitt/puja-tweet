/**
 * Tweet context (campaign) management routes.
 * Unknown `:id` values are rejected with 404 before any handler runs.
 */

import { Router } from 'express';
import type { AppDeps } from '../app.js';
import { HttpError, toHttpError } from '../middleware/error.js';

export const createContextsRouter = ({ services, scheduler }: AppDeps) => {
  const router = Router();

  router.param('id', (_req, _res, next, id) => {
    if (!services.contexts.getContext(id)) {
      return next(new HttpError(404, `Context ${id} not found`));
    }
    next();
  });

  router.get('/contexts', (_req, res) => {
    res.json({
      contexts: services.contexts.getContexts(),
      activeContextId: services.contexts.getActiveContext().id,
      nextPosts: scheduler.getAllNextScheduledPosts(),
    });
  });

  router.post('/contexts', (req, res, next) => {
    try {
      const created = services.contexts.createContext(req.body);
      res.json({
        success: true,
        context: created,
        contexts: services.contexts.getContexts(),
        queue: services.queue.getQueue(),
      });
    } catch (err) {
      next(toHttpError(err, 400));
    }
  });

  router.put('/contexts/:id', (req, res, next) => {
    try {
      const updated = services.contexts.updateContext(req.params.id, req.body);
      res.json({
        success: true,
        context: updated,
        contexts: services.contexts.getContexts(),
        queue: services.queue.getQueue(),
      });
    } catch (err) {
      next(toHttpError(err, 400));
    }
  });

  router.delete('/contexts/:id', (req, res, next) => {
    try {
      const ok = services.contexts.deleteContext(req.params.id);
      res.json({
        success: ok,
        contexts: services.contexts.getContexts(),
        activeContextId: services.contexts.getActiveContext().id,
        queue: services.queue.getQueue(),
      });
    } catch (err) {
      next(toHttpError(err, 400));
    }
  });

  router.post('/contexts/:id/activate', (req, res, next) => {
    try {
      const active = services.contexts.setActiveContextId(req.params.id);
      res.json({
        success: true,
        activeContext: active,
        contexts: services.contexts.getContexts(),
        queue: services.queue.getQueue(active.id),
      });
    } catch (err) {
      next(toHttpError(err, 400));
    }
  });

  router.post('/contexts/:id/toggle', (req, res, next) => {
    try {
      const toggled = services.contexts.toggleContext(req.params.id);
      res.json({
        success: true,
        context: toggled,
        contexts: services.contexts.getContexts(),
        queue: services.queue.getQueue(),
      });
    } catch (err) {
      next(toHttpError(err, 400));
    }
  });

  router.post('/contexts/:id/duplicate', (req, res, next) => {
    try {
      const duplicated = services.contexts.duplicateContext(req.params.id);
      res.json({
        success: true,
        context: duplicated,
        contexts: services.contexts.getContexts(),
        queue: services.queue.getQueue(),
      });
    } catch (err) {
      next(toHttpError(err, 400));
    }
  });

  router.post('/contexts/:id/reset-chain', (req, res, next) => {
    try {
      const updated = services.contexts.resetContextChain(req.params.id);
      res.json({
        success: true,
        context: updated,
        contexts: services.contexts.getContexts(),
        queue: services.queue.getQueue(),
      });
    } catch (err) {
      next(toHttpError(err, 400));
    }
  });

  router.post('/contexts/:id/clear-history', (req, res, next) => {
    try {
      const result = services.logs.clearContextHistory(req.params.id);
      res.json({
        success: true,
        clearedCount: result.clearedCount,
        context: result.context,
        contexts: services.contexts.getContexts(),
        logs: services.logs.getLogs(),
        queue: services.queue.getQueue(),
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
