import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  hourInZone,
  matchFixedTime,
  normalizeHHmm,
  resolveTimezone,
  slotTypeForHour,
  zonedParts,
} from '../../shared/time.js';

afterEach(() => vi.useRealTimers());

describe('normalizeHHmm', () => {
  it('pads and trims', () => {
    expect(normalizeHHmm('6:00')).toBe('06:00');
    expect(normalizeHHmm(' 18:5 ')).toBe('18:05');
  });
  it('rejects invalid', () => {
    expect(normalizeHHmm('24:00')).toBeNull();
    expect(normalizeHHmm('abc')).toBeNull();
    expect(normalizeHHmm('12:60')).toBeNull();
  });
});

describe('resolveTimezone', () => {
  it('maps MST/empty/invalid to America/Denver', () => {
    expect(resolveTimezone('MST')).toBe('America/Denver');
    expect(resolveTimezone('')).toBe('America/Denver');
    expect(resolveTimezone('Not/AZone')).toBe('America/Denver');
    expect(resolveTimezone('Europe/Paris')).toBe('Europe/Paris');
  });
});

describe('slotTypeForHour', () => {
  it('splits at noon', () => {
    expect(slotTypeForHour(6)).toBe('morning');
    expect(slotTypeForHour(11)).toBe('morning');
    expect(slotTypeForHour(12)).toBe('evening');
    expect(slotTypeForHour(18)).toBe('evening');
  });
});

describe('DST boundaries (America/Denver)', () => {
  it('06:00 local is 13:00Z before spring-forward and 12:00Z after', () => {
    expect(hourInZone(new Date('2026-03-07T13:00:00Z'), 'America/Denver')).toBe(6);
    expect(hourInZone(new Date('2026-03-09T12:00:00Z'), 'America/Denver')).toBe(6);
    expect(hourInZone(new Date('2026-03-09T13:00:00Z'), 'America/Denver')).toBe(7);
  });
  it('06:00 local is 12:00Z before fall-back and 13:00Z after', () => {
    expect(hourInZone(new Date('2026-10-31T12:00:00Z'), 'America/Denver')).toBe(6);
    expect(hourInZone(new Date('2026-11-02T13:00:00Z'), 'America/Denver')).toBe(6);
    expect(hourInZone(new Date('2026-11-02T12:00:00Z'), 'America/Denver')).toBe(5);
  });
  it('midnight is hour 0, not 24', () => {
    expect(zonedParts(new Date('2026-06-01T06:00:00Z'), 'America/Denver').hour).toBe(0);
  });
});

describe('matchFixedTime with fake timers', () => {
  it('matches "6:00" against 06:00 local on both sides of DST changes', () => {
    vi.useFakeTimers();
    for (const iso of [
      '2026-03-07T13:00:30Z',
      '2026-03-08T12:00:30Z', // spring-forward day: 06:00 MDT
      '2026-11-01T13:00:30Z', // fall-back day: 06:00 MST
      '2026-11-02T13:00:30Z',
    ]) {
      vi.setSystemTime(new Date(iso));
      const m = matchFixedTime(['6:00', '18:00'], new Date(), 'America/Denver');
      expect(m?.matchedTime).toBe('06:00');
      expect(m?.slotKey).toMatch(/^2026-\d\d-\d\d-06:00$/);
    }
  });
  it('does not match a different minute and keys differ per day', () => {
    const a = matchFixedTime(['06:00'], new Date('2026-03-08T12:00:00Z'), 'America/Denver');
    const b = matchFixedTime(['06:00'], new Date('2026-03-09T12:00:00Z'), 'America/Denver');
    expect(a?.slotKey).not.toBe(b?.slotKey);
    expect(
      matchFixedTime(['06:00'], new Date('2026-03-08T12:01:00Z'), 'America/Denver'),
    ).toBeNull();
  });
});
