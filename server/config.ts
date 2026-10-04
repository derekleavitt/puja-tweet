/**
 * Typed environment access for X ChromaBot server.
 * Single place that reads process.env for server wiring.
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const readVersion = (): string => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf-8'));
    return String(pkg.version || '0.0.0');
  } catch {
    return '0.0.0';
  }
};

export const config = {
  port: Number(process.env.PORT) || 3000,
  isProduction: process.env.NODE_ENV === 'production',
  rootDir,
  version: process.env.APP_VERSION || readVersion(),
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
