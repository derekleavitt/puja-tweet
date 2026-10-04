/**
 * POST /api/cron/tick: one scheduler tick driven by Cloud Scheduler (or curl) for scale-to-zero hosts.
 * Same code path as the interval loop; awaits the resulting drops and flushes state before replying.
 */

import { Router } from 'express';
import type { AppDeps } from '../app.js';
import { schedulerConfig } from '../config.js';
import { toHttpError } from '../middleware/error.js';
import { secretsMatch } from '../middleware/secret.js';

export const createCronRouter = ({ services, scheduler, cronSecret, maxDropsPerTick }: AppDeps) => {
  const router = Router();

  router.post('/cron/tick', async (req, res, next) => {
    try {
      const secret = cronSecret ?? schedulerConfig.cronSecret;
      if (!secret) {
        return res.status(503).json({ success: false, error: 'CRON_SECRET is not configured.' });
      }
      if (!secretsMatch(req.headers['x-cron-secret'], secret)) {
        return res.status(401).json({ success: false, error: 'Unauthorized. Send x-cron-secret.' });
      }

      const started = Date.now();
      const result = await scheduler.tick({
        maxDrops: maxDropsPerTick ?? schedulerConfig.maxDropsPerTick,
      });
      if (result.busy) {
        return res
          .status(409)
          .json({ success: false, error: 'A scheduler tick is already running.' });
      }
      await services.flush();
      res.json({
        success: true,
        fired: result.fired,
        skipped: result.skipped,
        durationMs: Date.now() - started,
      });
    } catch (err) {
      next(toHttpError(err, 500));
    }
  });

  return router;
};
