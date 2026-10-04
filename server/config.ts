/**
 * Typed environment access for X ChromaBot server.
 * Single place that reads process.env for server wiring.
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { OWNER_EMAIL } from '../shared/owner.js';

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
