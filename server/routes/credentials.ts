/**
 * The X app's keys (save, clear): consumer key/secret and the optional app-only bearer token.
 * Accounts are connected under /api/accounts; there are no user tokens here.
 */

import { Router } from 'express';
import type { AppDeps } from '../app.js';
import { toHttpError } from '../middleware/error.js';
import { CREDENTIAL_FIELDS } from '../services/credentialService.js';

export const createCredentialsRouter = ({ services }: AppDeps) => {
  const router = Router();

  router.post('/credentials', (req, res, next) => {
    try {
      // Missing or blank fields keep the stored value; only the known string fields are used.
      const body = req.body ?? {};
      const updates: Record<string, string> = {};
      for (const field of CREDENTIAL_FIELDS) {
        if (typeof body[field] === 'string') updates[field] = body[field].trim();
      }
      services.credentials.updateCredentials(updates);
      res.json({
        success: true,
        credentialsStatus: services.credentials.getMaskedCredentialsStatus(),
      });
    } catch (err) {
      next(toHttpError(err, 400));
    }
  });

  router.delete('/credentials/:method', (req, res, next) => {
    try {
      services.credentials.clearCredentials(req.params.method);
      res.json({
        success: true,
        credentialsStatus: services.credentials.getMaskedCredentialsStatus(),
      });
    } catch (err) {
      next(toHttpError(err, 400));
    }
  });

  return router;
};
