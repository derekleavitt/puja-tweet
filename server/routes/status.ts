/**
 * System status, rate-limit telemetry and global cooldown routes.
 */

import { Router } from 'express';
import type { AppDeps } from '../app.js';

export const createStatusRouter = ({ services, scheduler }: AppDeps) => {
  const router = Router();

  // System Status & Current State
  router.get('/status', (_req, res) => {
    const logs = services.logs.getLogs();

    const stats = {
      totalPosts: logs.length,
      successfulPosts: logs.filter((l) => l.status === 'success').length,
      simulatedPosts: logs.filter((l) => l.status === 'simulated').length,
      failedPosts: logs.filter((l) => l.status === 'error').length,
    };

    res.json({
      settings: services.settings.getSettings(),
      activeContext: services.contexts.getActiveContext(),
      contexts: services.contexts.getContexts(),
      nextPost: scheduler.getNextScheduledPost(),
      allNextPosts: scheduler.getAllNextScheduledPosts(),
      credentialsStatus: services.credentials.getMaskedCredentialsStatus(),
      stats,
      cooldownState: services.rateLimit.getCooldownState(),
      rateLimitTelemetry: services.rateLimit.getRateLimitTelemetry(),
      queue: services.queue.getQueue(),
      latestLog: logs[0] || null,
    });
  });

  router.get('/rate-limits', (_req, res) => {
    res.json({
      success: true,
      telemetry: services.rateLimit.getRateLimitTelemetry(),
      cooldownState: services.rateLimit.getCooldownState(),
    });
  });

  router.post('/cooldown/clear', (_req, res) => {
    services.rateLimit.clearGlobalCooldown();
    res.json({ success: true, cooldownState: services.rateLimit.getCooldownState() });
  });

  return router;
};
