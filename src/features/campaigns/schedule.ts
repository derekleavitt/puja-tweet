/**
 * X ChromaBot - campaign schedule helpers
 */

/** Normalizes "6:00" / "06:00" to zero-padded "HH:mm"; returns null when invalid. */
export function normalizeHHmm(value: string): string | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

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
