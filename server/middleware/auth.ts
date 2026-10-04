/**
 * Firebase ID-token authentication for /api/* (SEC-2).
 * Verifies `Authorization: Bearer <idToken>` and checks the email against AUTHORIZED_EMAILS.
 */

import type { RequestHandler } from 'express';
import { getAuth } from 'firebase-admin/auth';
import { authConfig } from '../config.js';
import { getAdminApp } from '../firebaseAdmin.js';

export interface VerifiedToken {
  email?: string;
  email_verified?: boolean;
}

export type TokenVerifier = (idToken: string) => Promise<VerifiedToken>;

/** Paths (relative to /api) that stay public or keep their own secret auth. */
const EXEMPT_PATHS = new Set(['/health', '/cron/trigger', '/webhook/trigger']);

/** Default verifier backed by firebase-admin (ADC, GOOGLE_APPLICATION_CREDENTIALS or service-account JSON). */
export const createFirebaseVerifier = (): TokenVerifier => {
  return async (idToken) => {
    return getAuth(getAdminApp()).verifyIdToken(idToken);
  };
};

export interface RequireAdminOptions {
  verifyToken?: TokenVerifier;
  authorizedEmails?: string[];
  disabled?: boolean;
}

export const requireAdmin = (options: RequireAdminOptions = {}): RequestHandler => {
  const verifyToken = options.verifyToken ?? createFirebaseVerifier();
  const authorizedEmails = (options.authorizedEmails ?? authConfig.authorizedEmails).map((e) =>
    e.toLowerCase(),
  );
  const disabled = options.disabled ?? authConfig.disabled;

  if (disabled) {
    console.warn(
      '[Auth] WARNING: AUTH_DISABLED=true - every /api route is UNAUTHENTICATED. Local development only!',
    );
  }

  return async (req, res, next) => {
    if (disabled || EXEMPT_PATHS.has(req.path)) return next();

    const match = /^Bearer (.+)$/i.exec(req.headers.authorization || '');
    if (!match) {
      return res.status(401).json({ success: false, error: 'Authentication required.' });
    }

    let decoded: VerifiedToken;
    try {
      decoded = await verifyToken(match[1]);
    } catch (err: any) {
      console.warn(`[Auth] Token verification failed: ${err?.code || err?.message}`);
      return res.status(401).json({ success: false, error: 'Invalid or expired token.' });
    }

    const email = decoded.email?.toLowerCase();
    if (!email || decoded.email_verified === false || !authorizedEmails.includes(email)) {
      return res.status(403).json({ success: false, error: 'This account is not authorized.' });
    }
    next();
  };
};
