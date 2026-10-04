/**
 * X API credential routes (save, clear one auth method, verify).
 */

import { Router } from 'express';
import type { AppDeps } from '../app.js';
import { toHttpError } from '../middleware/error.js';
import { verifyTwitterCredentials } from '../twitterClient.js';
import { errorMessage } from '../errorMessage.js';

const CREDENTIAL_FIELDS = [
  'apiKey',
  'apiSecret',
  'accessToken',
  'accessTokenSecret',
  'oauth2ClientId',
  'oauth2ClientSecret',
  'oauth2AccessToken',
  'oauth2RefreshToken',
  'bearerToken',
] as const;

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

  router.post('/twitter/verify', async (_req, res) => {
    try {
      const result = await verifyTwitterCredentials(services.credentials.getEffectiveCredentials());
      res.json(result);
    } catch (err) {
      res.status(500).json({ valid: false, message: errorMessage(err) });
    }
  });

  return router;
};
