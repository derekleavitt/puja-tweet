/**
 * Post history (log) routes.
 */

import { Router } from 'express';
import type { AppDeps } from '../app.js';

export const createHistoryRouter = ({ services }: AppDeps) => {
  const router = Router();

  router.get('/history', (_req, res) => {
    res.json({ logs: services.logs.getLogs() });
  });

  router.delete('/history', (_req, res) => {
    services.logs.clearLogs();
    res.json({ success: true });
  });

  return router;
};
