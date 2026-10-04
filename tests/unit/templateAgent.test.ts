import { describe, expect, it } from 'vitest';
import { generateColor } from '../../server/colorEngine.js';
import { substituteVariables } from '../../server/templateAgent.js';

const TOKENS = [
  'weather_tweet', 'color_pick', 'color_name', 'weather_desc', 'weather_description',
  'time_tag', 'time_slot', 'hex', 'rgb', 'hsl', 'cmyk', 'mood', 'swatch_bar', 'companions',
];

describe('substituteVariables', () => {
  const color = generateColor('morning');

  it.each(TOKENS)('replaces {%s}', (token) => {
    const out = substituteVariables(`[{${token}}]`, color, 'TAG');
    expect(out).not.toContain(`{${token}}`);
    expect(out.length).toBeGreaterThan(2);
  });

  it('substitutes concrete values', () => {
    const out = substituteVariables('{color_pick}|{hex}|{time_tag}|{rgb}', color, '6:00 AM');
    expect(out).toBe(`${color.colorPick}|${color.hex}|6:00 AM|${color.rgb.r}, ${color.rgb.g}, ${color.rgb.b}`);
  });

  it('replaces repeated tokens and leaves unknown ones alone', () => {
    expect(substituteVariables('{hex} {hex} {nope}', color)).toBe(`${color.hex} ${color.hex} {nope}`);
  });

  it('defaults the time tag from the slot type', () => {
    expect(substituteVariables('{time_tag}', generateColor('evening'))).toBe('6:00 PM');
  });
});
