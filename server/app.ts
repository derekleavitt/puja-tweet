/**
 * Express application factory for X ChromaBot.
 * Builds the API app without listening so it can be mounted by tests.
 */

import express from 'express';
import type { scheduler as schedulerInstance } from './scheduler.js';
import type { Services } from './services/index.js';
import { requireAdmin, type TokenVerifier } from './middleware/auth.js';
import { errorHandler } from './middleware/error.js';
import { createContextsRouter } from './routes/contexts.js';
import { createCredentialsRouter } from './routes/credentials.js';
import { createDropsRouter } from './routes/drops.js';
import { createExportRouter } from './routes/export.js';
import { createHealthRouter } from './routes/health.js';
import { createHistoryRouter } from './routes/history.js';
import { createQueueRouter } from './routes/queue.js';
import { createSettingsRouter } from './routes/settings.js';
import { createStatusRouter } from './routes/status.js';
import { createWebhookRouter } from './routes/webhook.js';

export interface AppDeps {
  services: Services;
  scheduler: typeof schedulerInstance;
  /** Injectable Firebase ID-token verifier (tests stub it); defaults to firebase-admin. */
  verifyToken?: TokenVerifier;
  authorizedEmails?: string[];
  authDisabled?: boolean;
}

export const createApp = (deps: AppDeps) => {
  const app = express();

  app.use(express.json());

  // Public; must stay above any auth middleware
  app.use('/api/health', createHealthRouter());

  app.use(
    '/api',
    requireAdmin({
      verifyToken: deps.verifyToken,
      authorizedEmails: deps.authorizedEmails,
      disabled: deps.authDisabled,
    }),
  );

  app.use('/api', createStatusRouter(deps));
  app.use('/api', createContextsRouter(deps));
  app.use('/api', createSettingsRouter(deps));
  app.use('/api', createCredentialsRouter(deps));
  app.use('/api', createDropsRouter(deps));
  app.use('/api', createWebhookRouter(deps));
  app.use('/api', createQueueRouter(deps));
  app.use('/api', createHistoryRouter(deps));
  app.use('/api', createExportRouter(deps));

  app.use(errorHandler);

  return app;
};
