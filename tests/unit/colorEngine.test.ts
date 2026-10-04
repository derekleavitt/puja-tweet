import { describe, expect, it } from 'vitest';
import {
  generateColor,
  generateWeatherDescription,
  hexToRgb,
  hslToHex,
  rgbToHex,
  rgbToHsl,
} from '../../server/colorEngine.js';

describe('generateColor', () => {
  it.each(['morning', 'evening'] as const)('returns a well-formed %s color', (slot) => {
    for (let i = 0; i < 25; i++) {
      const c = generateColor(slot);
      expect(c.slotType).toBe(slot);
      expect(c.hex).toMatch(/^#[0-9a-fA-F]{6}$/);
      for (const v of Object.values(c.rgb)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(255);
      }
      expect(c.hsl.h).toBeGreaterThanOrEqual(0);
      expect(c.hsl.h).toBeLessThanOrEqual(360);
      expect(c.hsl.s).toBeGreaterThanOrEqual(0);
      expect(c.hsl.s).toBeLessThanOrEqual(100);
      expect(c.hsl.l).toBeGreaterThanOrEqual(0);
      expect(c.hsl.l).toBeLessThanOrEqual(100);
      for (const v of Object.values(c.cmyk)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
      expect(['#000000', '#FFFFFF']).toContain(c.contrastText);
      expect(c.companions.length).toBeGreaterThan(0);
      expect(c.weatherTweet).toContain(c.weatherDesc);
    }
  });

  it('random slot resolves to morning or evening', () => {
    expect(['morning', 'evening']).toContain(generateColor('random').slotType);
  });
});

describe('generateWeatherDescription', () => {
  it.each([true, false])('has 3-5 words (sunrise=%s)', (isSunrise) => {
    for (let i = 0; i < 200; i++) {
      const words = generateWeatherDescription(isSunrise).trim().split(/\s+/);
      expect(words.length).toBeGreaterThanOrEqual(3);
      expect(words.length).toBeLessThanOrEqual(5);
    }
  });
});

describe('color conversions', () => {
  it('expands 3-digit hex', () => {
    expect(hexToRgb('#fa0')).toEqual({ r: 255, g: 170, b: 0 });
  });

  it('round-trips hex -> rgb -> hex', () => {
    for (const hex of ['#000000', '#ffffff', '#f59e0b', '#1e1b4b', '#7dd3fc']) {
      const { r, g, b } = hexToRgb(hex);
      expect(rgbToHex(r, g, b).toLowerCase()).toBe(hex);
    }
  });

  it('round-trips rgb -> hsl -> hex within rounding tolerance', () => {
    for (const hex of ['#f59e0b', '#581c87', '#6ee7b7', '#991b1b']) {
      const { r, g, b } = hexToRgb(hex);
      const { h, s, l } = rgbToHsl(r, g, b);
      const back = hexToRgb(hslToHex(h, s, l));
      expect(Math.abs(back.r - r)).toBeLessThanOrEqual(3);
      expect(Math.abs(back.g - g)).toBeLessThanOrEqual(3);
      expect(Math.abs(back.b - b)).toBeLessThanOrEqual(3);
    }
  });
});
