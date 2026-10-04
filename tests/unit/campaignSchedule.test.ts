import { describe, expect, it } from 'vitest';
import { invalidTimes, normalizeHHmm, parseTimesList } from '../../src/features/campaigns/schedule.js';

describe('normalizeHHmm', () => {
  it('pads and validates', () => {
    expect(normalizeHHmm('6:00')).toBe('06:00');
    expect(normalizeHHmm('18:30')).toBe('18:30');
    expect(normalizeHHmm('24:00')).toBeNull();
    expect(normalizeHHmm('12:60')).toBeNull();
    expect(normalizeHHmm('noon')).toBeNull();
  });
});

describe('times list', () => {
  it('parses and flags invalid entries', () => {
    expect(parseTimesList('06:00, 18:00,,')).toEqual(['06:00', '18:00']);
    expect(invalidTimes(['06:00', '25:00', 'x'])).toEqual(['25:00', 'x']);
  });
});
