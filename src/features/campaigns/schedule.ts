/**
 * X ChromaBot - campaign schedule helpers
 */

import { normalizeHHmm } from '../../../shared/time.js';

export { normalizeHHmm };

export function parseTimesList(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Returns entries that are not valid HH:mm. */
export function invalidTimes(times: string[]): string[] {
  return times.filter((t) => normalizeHHmm(t) === null);
}
