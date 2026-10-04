/**
 * Serverless mode: Cloud Run throttles CPU once the response is sent, so debounced saves could be lost.
 * Holds the response of every mutating request until pending state has reached the store.
 */

import type { RequestHandler } from 'express';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const flushBeforeResponse = (flush: () => Promise<void>): RequestHandler => {
  return (req, res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();
    const end = res.end.bind(res) as (...args: unknown[]) => unknown;
    res.end = ((...args: unknown[]) => {
      flush()
        .catch((err) => console.error('[Store] Flush before response failed:', err))
        .finally(() => end(...args));
      return res;
    }) as typeof res.end;
    next();
  };
};
