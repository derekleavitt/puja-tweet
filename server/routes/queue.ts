/**
 * Upcoming color queue routes.
 */

import { Router } from 'express';
import type { AppDeps } from '../app.js';

export const createQueueRouter = ({ services }: AppDeps) => {
  const router = Router();

  router.get('/queue', (req, res) => {
    const contextId = req.query.contextId as string | undefined;
    res.json({ queue: services.queue.getQueue(contextId) });
  });

  router.post('/queue/regenerate', (req, res) => {
    const contextId = req.body?.contextId || req.query?.contextId;
    const queue = services.queue.clearAndRegenerateQueue(
      contextId ? String(contextId) : services.contexts.getActiveContext().id,
    );
    res.json({ success: true, queue });
  });

  router.post('/queue/reroll', (req, res) => {
    const { slotId } = req.body;
    if (!slotId) {
      return res.status(400).json({ error: 'slotId required' });
    }
    const updated = services.queue.rerollQueueSlot(slotId);
    if (!updated) {
      return res.status(404).json({ error: 'Slot not found' });
    }
    res.json({ slot: updated });
  });

  return router;
};
