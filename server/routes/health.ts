/**
 * Unauthenticated liveness/readiness route for load balancers and container platforms.
 * Mounted as /api/health before any auth middleware.
 */

import { Router } from 'express';
import { config } from '../config.js';
import { storeKind } from '../services/index.js';

let schedulerRunning = false;

/** Called by the boot entrypoint once the scheduler loop has started. */
export const markSchedulerStarted = () => {
  schedulerRunning = true;
};

export const createHealthRouter = () => {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json({
      success: true,
      ok: true,
      version: config.version,
      store: storeKind(),
      schedulerRunning,
      uptimeSeconds: Math.round(process.uptime()),
    });
  });

  return router;
};
