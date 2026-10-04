/**
 * Typed environment access for X ChromaBot server.
 * Single place that reads process.env for server wiring.
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { OWNER_EMAIL } from '../shared/owner.js';

/**
 * Secrets pasted into Secret Manager or generated with `openssl rand -hex` often carry a
 * trailing newline; a single invisible character makes shared-secret checks fail (401).
 * Normalise them once at boot, before anything reads them.
 */
export const SECRET_ENV_NAMES = [
  'CRON_SECRET',
  'WEBHOOK_SECRET',
  'CREDENTIALS_ENCRYPTION_KEY',
  'GEMINI_API_KEY',
  'TWITTER_API_KEY',
  'TWITTER_API_SECRET',
  'TWITTER_ACCESS_TOKEN',
  'TWITTER_ACCESS_TOKEN_SECRET',
  'TWITTER_BEARER_TOKEN',
  'TWITTER_OAUTH2_CLIENT_ID',
  'TWITTER_OAUTH2_CLIENT_SECRET',
  'TWITTER_OAUTH2_ACCESS_TOKEN',
  'TWITTER_OAUTH2_REFRESH_TOKEN',
] as const;

export const normaliseSecretEnv = (env: NodeJS.ProcessEnv = process.env) => {
  for (const name of SECRET_ENV_NAMES) {
    const value = env[name];
    if (typeof value === 'string') env[name] = value.trim();
  }
};

normaliseSecretEnv();

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const readFirebaseAppletConfig = (): { projectId?: string; firestoreDatabaseId?: string } => {
  try {
    return JSON.parse(fs.readFileSync(path.join(rootDir, 'firebase-applet-config.json'), 'utf-8'));
  } catch {
    return {};
  }
};

const firebaseAppletConfig = readFirebaseAppletConfig();

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
/** Firestore persistence (STORE=firestore): named AI Studio database by default. */
export const firestoreConfig = {
  projectId: process.env.FIREBASE_PROJECT_ID || firebaseAppletConfig.projectId || undefined,
  databaseId:
    process.env.FIRESTORE_DATABASE_ID || firebaseAppletConfig.firestoreDatabaseId || '(default)',
};

export const authConfig = {
  disabled: process.env.AUTH_DISABLED === 'true',
  projectId: process.env.FIREBASE_PROJECT_ID || firebaseAppletConfig.projectId || undefined,
  serviceAccountJson: process.env.FIREBASE_SERVICE_ACCOUNT_JSON || undefined,
  authorizedEmails: (process.env.AUTHORIZED_EMAILS || OWNER_EMAIL)
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
};

/**
 * Scheduler wiring. `interval` (default) runs an in-process 10 s loop; `external` is for
 * scale-to-zero hosts (Cloud Run) where Cloud Scheduler POSTs /api/cron/tick every minute.
 */
export type SchedulerMode = 'interval' | 'external';

const positiveInt = (raw: string | undefined, fallback: number): number => {
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const schedulerConfig = {
  mode: (process.env.SCHEDULER_MODE?.trim().toLowerCase() === 'external'
    ? 'external'
    : 'interval') as SchedulerMode,
  cronSecret: process.env.CRON_SECRET || '',
  maxDropsPerTick: positiveInt(process.env.MAX_DROPS_PER_TICK, 5),
};
