/**
 * Express application factory for X ChromaBot.
 * Builds the API app without listening so it can be mounted by tests.
 */

import express from 'express';
import type { scheduler as schedulerInstance } from './scheduler.js';
import type { DropService } from './services/dropService.js';
import type { Services } from './services/index.js';
import { requireAdmin, type TokenVerifier } from './middleware/auth.js';
import { schedulerConfig, type SchedulerMode } from './config.js';
import { errorHandler } from './middleware/error.js';
import { flushBeforeResponse } from './middleware/flushOnWrite.js';
import { createContextsRouter } from './routes/contexts.js';
import { createCredentialsRouter } from './routes/credentials.js';
import { createCronRouter } from './routes/cron.js';
import { createDropsRouter } from './routes/drops.js';
import { createHealthRouter } from './routes/health.js';
import { createHistoryRouter } from './routes/history.js';
import { createQueueRouter } from './routes/queue.js';
import { createSettingsRouter } from './routes/settings.js';
import { createStatusRouter } from './routes/status.js';
import { createWebhookRouter } from './routes/webhook.js';

export interface AppDeps {
  services: Services;
  scheduler: typeof schedulerInstance;
  drops: DropService;
  /** Injectable Firebase ID-token verifier (tests stub it); defaults to firebase-admin. */
  verifyToken?: TokenVerifier;
  authorizedEmails?: string[];
  authDisabled?: boolean;
  /** Defaults to SCHEDULER_MODE. `external` flushes state before every non-GET response. */
  schedulerMode?: SchedulerMode;
  /** Overrides CRON_SECRET ('' = unset, the tick route answers 503). */
  cronSecret?: string;
  /** Overrides MAX_DROPS_PER_TICK. */
  maxDropsPerTick?: number;
}

export const createApp = (deps: AppDeps) => {
  const app = express();

  app.use(express.json());

  // Public; must stay above any auth middleware
  app.use('/api/health', createHealthRouter());

  if ((deps.schedulerMode ?? schedulerConfig.mode) === 'external') {
    app.use(
      '/api',
      flushBeforeResponse(() => deps.services.flush()),
    );
  }

  app.use(
    '/api',
    requireAdmin({
      verifyToken: deps.verifyToken,
      authorizedEmails: deps.authorizedEmails,
      disabled: deps.authDisabled,
    }),
  );

  app.use('/api', createCronRouter(deps));
  app.use('/api', createStatusRouter(deps));
  app.use('/api', createContextsRouter(deps));
  app.use('/api', createSettingsRouter(deps));
  app.use('/api', createCredentialsRouter(deps));
  app.use('/api', createDropsRouter(deps));
  app.use('/api', createWebhookRouter(deps));
  app.use('/api', createQueueRouter(deps));
  app.use('/api', createHistoryRouter(deps));

  app.use(errorHandler);

  return app;
};
