/**
 * Post history (log) routes.
 */

import { Router } from 'express';
import type { AppDeps } from '../app.js';

export const createHistoryRouter = ({ storage }: AppDeps) => {
  const router = Router();

  router.get('/history', (req, res) => {
    res.json({ logs: storage.getLogs() });
  });

  router.delete('/history', (req, res) => {
    storage.clearLogs();
    res.json({ success: true });
  });

  return router;
};
