/**
 * Timing-safe shared-secret comparison (webhook and cron tick).
 */

import crypto from 'crypto';

export const secretsMatch = (provided: unknown, expected: string): boolean => {
  if (typeof provided !== 'string' || !expected) return false;
  const a = crypto.createHash('sha256').update(provided).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
};
