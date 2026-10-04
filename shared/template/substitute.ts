/**
 * The ONE implementation of {token} substitution for tweet templates.
 */
import type { ColorData } from '../types.js';

export const TEMPLATE_TOKENS = [
  '{color_pick}',
  '{weather_desc}',
  '{weather_tweet}',
  '{time_tag}',
  '{color_name}',
  '{hex}',
  '{rgb}',
  '{hsl}',
  '{cmyk}',
  '{mood}',
  '{swatch_bar}',
] as const;

export interface SubstituteOptions {
  /** Label for {time_tag}/{time_slot}; defaults to 6:00 AM / 6:00 PM by slot type. */
  slotLabel?: string;
  /** Used for {weather_desc} when the color has none (evaluated lazily). */
  fallbackWeatherDesc?: string | (() => string);
}

export function substituteTemplate(template: string, color: ColorData, options: SubstituteOptions = {}): string {
  const timeTag = options.slotLabel || (color.slotType === 'morning' ? '6:00 AM' : '6:00 PM');
  const colorPick = color.colorPick || color.name;
  const fallback = options.fallbackWeatherDesc ?? 'atmospheric stillness';
  const weatherDesc = color.weatherDesc || (typeof fallback === 'function' ? fallback() : fallback);
  const weatherTweet = `${colorPick} ${weatherDesc} #eternal #colors`;

  return template
    .replace(/{weather_tweet}/g, weatherTweet)
    .replace(/{color_pick}/g, colorPick)
    .replace(/{color_name}/g, color.name)
    .replace(/{weather_desc}/g, weatherDesc)
    .replace(/{weather_description}/g, weatherDesc)
    .replace(/{time_tag}/g, timeTag)
    .replace(/{time_slot}/g, timeTag)
    .replace(/{hex}/g, color.hex)
    .replace(/{rgb}/g, `${color.rgb.r}, ${color.rgb.g}, ${color.rgb.b}`)
    .replace(/{hsl}/g, `${color.hsl.h}°, ${color.hsl.s}%, ${color.hsl.l}%`)
    .replace(/{cmyk}/g, `C:${color.cmyk.c}% M:${color.cmyk.m}% Y:${color.cmyk.y}% K:${color.cmyk.k}%`)
    .replace(/{mood}/g, color.mood)
    .replace(/{swatch_bar}/g, color.swatchBar || '')
    .replace(/{companions}/g, (color.companions || []).join(' '));
}
