/**
 * Error handling for the X ChromaBot API.
 * Every failure is mapped to `{ success: false, error }` with a real HTTP status.
 */

import type { ErrorRequestHandler } from 'express';

export class HttpError extends Error {
  public readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

/** Keeps an HttpError as is; wraps anything else with the given fallback status. */
export const toHttpError = (err: unknown, fallbackStatus: number): HttpError => {
  if (err instanceof HttpError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new HttpError(fallbackStatus, message);
};

export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }
  const httpError = toHttpError(err, 500);
  res.status(httpError.status).json({ success: false, error: httpError.message });
};
