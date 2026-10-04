/**
 * Post history (log) routes.
 */

import { Router } from 'express';
import type { AppDeps } from '../app.js';

export const createHistoryRouter = ({ storage }: AppDeps) => {
  const router = Router();

  router.get('/history', (_req, res) => {
    res.json({ logs: storage.getLogs() });
  });

  router.delete('/history', (_req, res) => {
    storage.clearLogs();
    res.json({ success: true });
  });

  return router;
};
