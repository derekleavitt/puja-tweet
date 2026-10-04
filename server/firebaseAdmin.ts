/**
 * Shared firebase-admin app (ADC, GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT_JSON),
 * used by both ID-token auth and the Firestore store.
 */

import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { authConfig } from './config.js';

export const getAdminApp = (): App =>
  getApps()[0] ??
  initializeApp({
    projectId: authConfig.projectId,
    ...(authConfig.serviceAccountJson
      ? { credential: cert(JSON.parse(authConfig.serviceAccountJson)) }
      : {}),
  });
