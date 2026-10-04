/**
 * Typed environment access for X ChromaBot server.
 * Single place that reads process.env for server wiring.
 */

import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT) || 3000,
  isProduction: process.env.NODE_ENV === 'production',
};

/** SEC-2: Firebase ID-token auth for /api/*. */
export const authConfig = {
  disabled: process.env.AUTH_DISABLED === 'true',
  projectId: process.env.FIREBASE_PROJECT_ID || undefined,
  serviceAccountJson: process.env.FIREBASE_SERVICE_ACCOUNT_JSON || undefined,
  authorizedEmails: (process.env.AUTHORIZED_EMAILS || '')
    .split(',')
    .map(email => email.trim().toLowerCase())
    .filter(Boolean),
};
