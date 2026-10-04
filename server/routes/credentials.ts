/**
 * X API credential routes (save + verify).
 */

import { Router } from 'express';
import type { AppDeps } from '../app.js';
import { toHttpError } from '../middleware/error.js';
import { verifyTwitterCredentials } from '../twitterClient.js';

export const createCredentialsRouter = ({ services }: AppDeps) => {
  const router = Router();

  router.post('/credentials', (req, res, next) => {
    try {
      const {
        apiKey,
        apiSecret,
        accessToken,
        accessTokenSecret,
        oauth2ClientId,
        oauth2ClientSecret,
        oauth2AccessToken,
        oauth2RefreshToken,
        bearerToken,
      } = req.body;
      services.credentials.updateCredentials({
        apiKey: apiKey?.trim(),
        apiSecret: apiSecret?.trim(),
        accessToken: accessToken?.trim(),
        accessTokenSecret: accessTokenSecret?.trim(),
        oauth2ClientId: oauth2ClientId?.trim(),
        oauth2ClientSecret: oauth2ClientSecret?.trim(),
        oauth2AccessToken: oauth2AccessToken?.trim(),
        oauth2RefreshToken: oauth2RefreshToken?.trim(),
        bearerToken: bearerToken?.trim(),
      });
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
    } catch (err: any) {
      res.status(500).json({ valid: false, message: err.message });
    }
  });

  return router;
};
