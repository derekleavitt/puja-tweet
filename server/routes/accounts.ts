/**
 * X accounts campaigns can post as: list, connect (OAuth 1.0a redirect or PIN), verify, rename,
 * remove. Behind requireAdmin like every /api route. Responses never contain tokens.
 */

import { Router, type Request } from 'express';
import type { AppDeps } from '../app.js';
import { HttpError, toHttpError } from '../middleware/error.js';

/** The SPA route X redirects back to (see src/features/settings/useOAuthCallback.ts). */
export const OAUTH_CALLBACK_PATH = '/oauth/x/callback';

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])$/;

/** Extra allowed callback origins (env OAUTH_CALLBACK_ORIGINS, comma-separated), e.g. a custom domain. */
const allowedOrigins = () =>
  (process.env.OAUTH_CALLBACK_ORIGINS || '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);

/**
 * Only `<this site>/oauth/x/callback` is accepted: same host as the request (https, or http on
 * localhost) or an allow-listed origin. Never an arbitrary URL.
 */
export const validateCallbackUrl = (raw: unknown, req: Pick<Request, 'get'>): string => {
  const reject = () =>
    new HttpError(400, `callbackUrl must be this site's ${OAUTH_CALLBACK_PATH} address.`);
  if (typeof raw !== 'string') throw reject();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw reject();
  }
  if (url.pathname !== OAUTH_CALLBACK_PATH || url.search || url.hash || url.username) {
    throw reject();
  }
  if (allowedOrigins().includes(url.origin)) return url.toString();
  const host = req.get('host');
  const secure =
    url.protocol === 'https:' || (url.protocol === 'http:' && LOCAL_HOST.test(url.hostname));
  if (!host || url.host !== host || !secure) throw reject();
  return url.toString();
};

export const createAccountsRouter = ({ services }: AppDeps) => {
  const router = Router();
  const list = () => services.accounts.list();

  router.get('/accounts', (_req, res) => {
    res.json({ success: true, accounts: list() });
  });

  router.post('/accounts/connect/start', async (req, res, next) => {
    try {
      const mode = req.body?.mode === 'pin' ? 'pin' : 'redirect';
      const callback = mode === 'pin' ? 'oob' : validateCallbackUrl(req.body?.callbackUrl, req);
      const started = await services.accounts.startConnect(callback);
      res.json({ success: true, mode, ...started });
    } catch (err) {
      next(toHttpError(err, 502));
    }
  });

  router.post('/accounts/connect/complete', async (req, res, next) => {
    try {
      const { oauthToken, verifier } = req.body ?? {};
      if (typeof oauthToken !== 'string' || !oauthToken.trim()) {
        throw new HttpError(400, 'oauthToken is required');
      }
      if (typeof verifier !== 'string' || !verifier.trim()) {
        throw new HttpError(400, 'verifier (or PIN) is required');
      }
      const account = await services.accounts.completeConnect(oauthToken.trim(), verifier);
      res.json({ success: true, account, accounts: list() });
    } catch (err) {
      next(toHttpError(err, 502));
    }
  });

  router.post('/accounts/:id/verify', async (req, res, next) => {
    try {
      const result = await services.accounts.verify(req.params.id);
      res.json({ success: true, ...result, accounts: list() });
    } catch (err) {
      next(toHttpError(err, 500));
    }
  });

  router.patch('/accounts/:id', (req, res, next) => {
    try {
      const label = req.body?.label;
      if (typeof label !== 'string') throw new HttpError(400, 'label must be a string');
      const account = services.accounts.rename(req.params.id, label);
      res.json({ success: true, account, accounts: list() });
    } catch (err) {
      next(toHttpError(err, 400));
    }
  });

  router.delete('/accounts/:id', (req, res, next) => {
    try {
      const { pausedCampaigns } = services.accounts.remove(req.params.id);
      res.json({
        success: true,
        pausedCampaigns,
        accounts: list(),
        contexts: services.contexts.getContexts(),
      });
    } catch (err) {
      next(toHttpError(err, 400));
    }
  });

  return router;
};
