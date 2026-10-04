/**
 * Pure, timezone-aware time helpers shared by the server scheduler and scripts.
 * No I/O; everything takes explicit dates/timezones so it is trivially testable.
 */

export const DEFAULT_TIMEZONE = 'America/Denver';

/** Resolve a user-supplied timezone to a valid IANA zone ("MST"/empty/invalid -> America/Denver). */
export function resolveTimezone(tz?: string | null): string {
  const raw = (tz || '').trim();
  if (!raw || raw.toUpperCase() === 'MST') return DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: raw });
    return raw;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

/** Normalise "6:00" / "06:0" / " 18:30 " to zero-padded "HH:mm". Returns null when invalid. */
export function normalizeHHmm(input: string): string | null {
  const m = /^\s*(\d{1,2}):(\d{1,2})\s*$/.exec(input);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

export interface ZonedParts {
  /** YYYY-MM-DD in the zone */
  date: string;
  hour: number;
  minute: number;
  second: number;
  /** HH:mm in the zone */
  hhmm: string;
}

/** Wall-clock parts of `date` in `timeZone` (DST-aware via Intl). */
export function zonedParts(date: Date, timeZone?: string | null): ZonedParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: resolveTimezone(timeZone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '0';
  const hour = Number(get('hour')) % 24;
  const minute = Number(get('minute'));
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    hour,
    minute,
    second: Number(get('second')),
    hhmm: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
  };
}

export function hourInZone(date: Date, timeZone?: string | null): number {
  return zonedParts(date, timeZone).hour;
}

/** Format a loose "HH:mm" as "h:mm AM/PM" ("18:00" -> "6:00 PM"). Returns the input when invalid. */
export function formatHHmm12h(hhmm: string): string {
  const norm = normalizeHHmm(hhmm);
  if (!norm) return hhmm;
  const [h, m] = norm.split(':').map(Number);
  const suffix = h < 12 ? 'AM' : 'PM';
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** Local time of `date` in `timeZone` as "h:mm AM/PM" (the {time_tag} format). */
export function formatTimeInZone(date: Date, timeZone?: string | null): string {
  return formatHHmm12h(zonedParts(date, timeZone).hhmm);
}

/** Short timezone abbreviation for `date` in `timeZone` ("MST"/"MDT" for America/Denver). */
export function tzAbbreviation(date: Date, timeZone?: string | null): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: resolveTimezone(timeZone),
    timeZoneName: 'short',
  }).formatToParts(date);
  return parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
}

export function slotTypeForHour(hour: number): 'morning' | 'evening' {
  return hour < 12 ? 'morning' : 'evening';
}

/** Find the schedule entry (normalised "HH:mm") matching the current minute in the zone, if any. */
export function matchFixedTime(
  scheduleTimes: string[] | undefined,
  now: Date,
  timeZone?: string | null,
): { matchedTime: string; slotKey: string; parts: ZonedParts } | null {
  const parts = zonedParts(now, timeZone);
  const matched = (scheduleTimes || []).map(normalizeHHmm).find((t) => t === parts.hhmm);
  if (!matched) return null;
  return { matchedTime: matched, slotKey: `${parts.date}-${matched}`, parts };
}
