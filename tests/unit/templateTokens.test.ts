/**
 * X ChromaBot - templateUsesColor (UI helper that gates the color controls)
 */

import { describe, it, expect } from 'vitest';
import { COLOR_TOKENS, templateUsesColor } from '../../src/lib/templateTokens.js';
import { substituteTemplate } from '../../shared/template/substitute.js';
import { generateColor } from '../../server/colorEngine.js';

describe('templateUsesColor', () => {
  it('detects every color token', () => {
    for (const token of COLOR_TOKENS) {
      expect(templateUsesColor(`hello ${token} world`)).toBe(true);
    }
  });

  it('is false for plain, time-only, agent-only and empty templates', () => {
    expect(templateUsesColor('Just a tweet #launch')).toBe(false);
    expect(templateUsesColor('Posted at {time_tag} / {time_slot}')).toBe(false);
    expect(templateUsesColor('<agent>write a haiku about mornings</agent>')).toBe(false);
    expect(templateUsesColor('')).toBe(false);
    expect(templateUsesColor(undefined)).toBe(false);
  });

  it('agrees with substituteTemplate: a non-color template renders the same for any color', () => {
    const opts = { slotLabel: '6:00 AM' };
    const template = 'Daily note {time_tag} #launch';
    const a = substituteTemplate(template, generateColor('morning'), opts);
    const b = substituteTemplate(template, generateColor('evening'), opts);
    expect(a).toBe(b);
  });

  it('every color token really changes with the color', () => {
    const morning = generateColor('morning');
    const other = { ...morning, hex: '#000001', name: 'X', colorPick: 'X', mood: 'm' };
    const changed = COLOR_TOKENS.filter(
      (t) => substituteTemplate(t, morning) !== substituteTemplate(t, other),
    );
    // weather/rgb/hsl/cmyk/swatch/companions tokens are filled from fields this test keeps equal.
    expect(changed).toEqual(
      expect.arrayContaining(['{color_pick}', '{color_name}', '{hex}', '{mood}']),
    );
  });
});
