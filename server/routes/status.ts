/**
 * System status, rate-limit telemetry and global cooldown routes.
 */

import { Router } from 'express';
import type { AppDeps } from '../app.js';

export const createStatusRouter = ({ storage, scheduler }: AppDeps) => {
  const router = Router();

  // System Status & Current State
  router.get('/status', (req, res) => {
    const logs = storage.getLogs();

    const stats = {
      totalPosts: logs.length,
      successfulPosts: logs.filter(l => l.status === 'success').length,
      simulatedPosts: logs.filter(l => l.status === 'simulated').length,
      failedPosts: logs.filter(l => l.status === 'error').length,
    };

    res.json({
      settings: storage.getSettings(),
      activeContext: storage.getActiveContext(),
      contexts: storage.getContexts(),
      nextPost: scheduler.getNextScheduledPost(),
      allNextPosts: scheduler.getAllNextScheduledPosts(),
      credentialsStatus: storage.getMaskedCredentialsStatus(),
      stats,
      cooldownState: storage.getCooldownState(),
      rateLimitTelemetry: storage.getRateLimitTelemetry(),
      queue: storage.getQueue(),
      latestLog: logs[0] || null,
    });
  });

  router.get('/rate-limits', (req, res) => {
    res.json({
      success: true,
      telemetry: storage.getRateLimitTelemetry(),
      cooldownState: storage.getCooldownState(),
    });
  });

  router.post('/cooldown/clear', (req, res) => {
    storage.clearGlobalCooldown();
    res.json({ success: true, cooldownState: storage.getCooldownState() });
  });

  return router;
};
