/**
 * Color Engine for X ChromaBot
 * Generates rich, evocative colors tailored for Morning (6:00 AM) and Evening (6:00 PM) drops.
 */

import type { ColorData } from '../shared/types.js';
import { substituteTemplate } from '../shared/template/substitute.js';

export type { ColorData };

// Curated evocative colors for Sunrise (Morning 6:00 AM)
export const SUNRISE_PALETTES = [
  {
    name: 'Sunrise Amber',
    colorPick: 'Sunrise Amber',
    hex: '#F59E0B',
    mood: 'Rich honeyed sunrise cresting ancient sandstone bluffs',
  },
  {
    name: 'Sunrise Gold',
    colorPick: 'Sunrise Gold',
    hex: '#FBBF24',
    mood: 'First golden rays striking polished limestone summits',
  },
  {
    name: 'Sunrise Coral',
    colorPick: 'Sunrise Coral',
    hex: '#FB7185',
    mood: 'Gentle coral warmth diffusing through cirrus clouds',
  },
  {
    name: 'Sunrise Peach',
    colorPick: 'Sunrise Peach',
    hex: '#FDBA74',
    mood: 'Soft peach horizon glow spilling into coastal valleys',
  },
  {
    name: 'Sunrise Citrine',
    colorPick: 'Sunrise Citrine',
    hex: '#FDE047',
    mood: 'Vibrant luminous morning alertness and lucid optimism',
  },
  {
    name: 'Sunrise Rose',
    colorPick: 'Sunrise Rose',
    hex: '#F472B6',
    mood: 'Iridescent rose morning light over mirror lakes',
  },
  {
    name: 'Sunrise Saffron',
    colorPick: 'Sunrise Saffron',
    hex: '#EAB308',
    mood: 'Sun-warmed saffron blossoms greeting first dawn',
  },
  {
    name: 'Sunrise Tangerine',
    colorPick: 'Sunrise Tangerine',
    hex: '#FB923C',
    mood: 'Electric citrus dawn illuminating early morning skies',
  },
  {
    name: 'Dawn Apricot',
    colorPick: 'Dawn Apricot',
    hex: '#FED7AA',
    mood: 'Tender dawn hue resting quietly on alpine pines',
  },
  {
    name: 'Dawn Lilac',
    colorPick: 'Dawn Lilac',
    hex: '#D8B4FE',
    mood: 'Hazy lavender ether resting in quiet river hollows',
  },
  {
    name: 'Dawn Azure',
    colorPick: 'Dawn Azure',
    hex: '#7DD3FC',
    mood: 'Pristine morning azure before vapor trails emerge',
  },
  {
    name: 'Dawn Copper',
    colorPick: 'Dawn Copper',
    hex: '#D97706',
    mood: 'Warm metallic dawn breaking across desert plateaus',
  },
  {
    name: 'Dawn Vermilion',
    colorPick: 'Dawn Vermilion',
    hex: '#F43F5E',
    mood: 'Fiery horizon streak welcoming crisp daybreak',
  },
  {
    name: 'Dawn Mint',
    colorPick: 'Dawn Mint',
    hex: '#6EE7B7',
    mood: 'Crisp glacial dawn breaking over sub-polar fjords',
  },
  {
    name: 'Dawn Blush',
    colorPick: 'Dawn Blush',
    hex: '#FDA4AF',
    mood: 'Soft pastel radiance dancing across dewy fields',
  },
  {
    name: 'Dawn Cerulean',
    colorPick: 'Dawn Cerulean',
    hex: '#38BDF8',
    mood: 'Pure morning light reflected in mountain tarns',
  },
  {
    name: 'Sunrise Opal',
    colorPick: 'Sunrise Opal',
    hex: '#E2E8F0',
    mood: 'Cool architectural stillness at the earliest waking hour',
  },
  {
    name: 'Dawn Topaz',
    colorPick: 'Dawn Topaz',
    hex: '#CA8A04',
    mood: 'Deep amber rays warming chilled valley stones',
  },
];

// Curated evocative colors for Sunset (Evening 6:00 PM)
export const SUNSET_PALETTES = [
  {
    name: 'Sunset Indigo',
    colorPick: 'Sunset Indigo',
    hex: '#1E1B4B',
    mood: 'Infinite celestial depths emerging as the first stars appear',
  },
  {
    name: 'Sunset Crimson',
    colorPick: 'Sunset Crimson',
    hex: '#991B1B',
    mood: 'Dying hearth coals glowing across the twilight horizon',
  },
  {
    name: 'Sunset Violet',
    colorPick: 'Sunset Violet',
    hex: '#581C87',
    mood: 'Lush imperial dusk wrapping the horizon in royal quietude',
  },
  {
    name: 'Sunset Cobalt',
    colorPick: 'Sunset Cobalt',
    hex: '#1E3A8A',
    mood: 'The transitional hour when day yields to nocturnal peace',
  },
  {
    name: 'Sunset Amber',
    colorPick: 'Sunset Amber',
    hex: '#B45309',
    mood: 'The welcoming warmth of cabin windows at sunset',
  },
  {
    name: 'Sunset Terracotta',
    colorPick: 'Sunset Terracotta',
    hex: '#9A3412',
    mood: 'Earthy warmth lingering on sun-baked desert adobe',
  },
  {
    name: 'Sunset Topaz',
    colorPick: 'Sunset Topaz',
    hex: '#78350F',
    mood: 'Warm amber shadows lengthening across teak floorboards',
  },
  {
    name: 'Sunset Magenta',
    colorPick: 'Sunset Magenta',
    hex: '#86198F',
    mood: 'Vibrant chromatic twilight hovering over distant peaks',
  },
  {
    name: 'Sunset Plum',
    colorPick: 'Sunset Plum',
    hex: '#3B0764',
    mood: 'Velvety twilight draping over silent city skylines',
  },
  {
    name: 'Sunset Copper',
    colorPick: 'Sunset Copper',
    hex: '#C2410C',
    mood: 'Burnished metallic radiance reflecting off calm tides',
  },
  {
    name: 'Sunset Amethyst',
    colorPick: 'Sunset Amethyst',
    hex: '#701A75',
    mood: 'Neon dusk reflections shimmering across rain-slicked asphalt',
  },
  {
    name: 'Sunset Ruby',
    colorPick: 'Sunset Ruby',
    hex: '#831843',
    mood: 'Rich vintage red poured in low evening candlelight',
  },
  {
    name: 'Dusk Carmine',
    colorPick: 'Dusk Carmine',
    hex: '#9F1239',
    mood: 'Deep romantic dusk settling over mountain ridges',
  },
  {
    name: 'Dusk Sapphire',
    colorPick: 'Dusk Sapphire',
    hex: '#172554',
    mood: 'Dense blue hour when birds fall silent and night rises',
  },
  {
    name: 'Dusk Mulberry',
    colorPick: 'Dusk Mulberry',
    hex: '#4C0519',
    mood: 'Velvety wine dusk enveloping autumn woodlands',
  },
  {
    name: 'Dusk Petrol',
    colorPick: 'Dusk Petrol',
    hex: '#0C4A6E',
    mood: 'Abyssal teal depths whispering under 6:00 PM coastal breeze',
  },
  {
    name: 'Dusk Bronze',
    colorPick: 'Dusk Bronze',
    hex: '#713F12',
    mood: 'Antiqued sunset bronze fading softly into starry dusk',
  },
  {
    name: 'Dusk Cypress',
    colorPick: 'Dusk Cypress',
    hex: '#064E3B',
    mood: 'Ancient evergreen silhouettes against a darkening violet sky',
  },
];

export const MORNING_PALETTES = SUNRISE_PALETTES;
export const EVENING_PALETTES = SUNSET_PALETTES;

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let cleanHex = hex.replace('#', '');
  if (cleanHex.length === 3) {
    cleanHex = cleanHex
      .split('')
      .map((c) => c + c)
      .join('');
  }
  const num = parseInt(cleanHex, 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return (
    '#' +
    [clamp(r), clamp(g), clamp(b)]
      .map((x) => x.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  );
}

export function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

export function rgbToCmyk(
  r: number,
  g: number,
  b: number,
): { c: number; m: number; y: number; k: number } {
  const rNorm = r / 255;
  const gNorm = g / 255;
  const bNorm = b / 255;

  const k = 1 - Math.max(rNorm, gNorm, bNorm);
  if (k === 1) {
    return { c: 0, m: 0, y: 0, k: 100 };
  }

  const c = (1 - rNorm - k) / (1 - k);
  const m = (1 - gNorm - k) / (1 - k);
  const y = (1 - bNorm - k) / (1 - k);

  return {
    c: Math.round(c * 100),
    m: Math.round(m * 100),
    y: Math.round(y * 100),
    k: Math.round(k * 100),
  };
}

export function getContrastTextColor(r: number, g: number, b: number): '#000000' | '#FFFFFF' {
  // WCAG relative luminance
  const sRGB = [r, g, b].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  const luminance = 0.2126 * sRGB[0] + 0.7152 * sRGB[1] + 0.0722 * sRGB[2];
  return luminance > 0.45 ? '#000000' : '#FFFFFF';
}

export function generateCompanionColors(hex: string): string[] {
  const rgb = hexToRgb(hex);
  const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);

  // Generate 4 companion hues: Analogous +30, Analogous -30, Complementary +180, Triad +120
  const shifts = [30, -30, 180, 120];
  return shifts.map((shift) => {
    const newH = (hsl.h + shift + 360) % 360;
    return hslToHex(newH, hsl.s, hsl.l);
  });
}

export function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color);
  };
  return rgbToHex(f(0), f(8), f(4));
}

// Generate aesthetic unicode block swatch
export function generateSwatchBar(hex: string): string {
  const rgb = hexToRgb(hex);
  const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);

  // Pick closest block emoji based on hue and lightness
  let emoji = '🟦';
  if (hsl.l < 18) emoji = '⬛';
  else if (hsl.l > 82) emoji = '⬜';
  else if (hsl.h < 25 || hsl.h >= 340) emoji = '🟥';
  else if (hsl.h < 50) emoji = '🟧';
  else if (hsl.h < 75) emoji = '🟨';
  else if (hsl.h < 170) emoji = '🟩';
  else if (hsl.h < 265) emoji = '🟦';
  else if (hsl.h < 310) emoji = '🟪';
  else emoji = '🟫';

  return `${emoji}${emoji}${emoji}${emoji}${emoji}`;
}

export function generateWeatherDescription(isSunrise: boolean): string {
  const sunriseActions = [
    'warming',
    'piercing',
    'melting',
    'greeting',
    'clearing',
    'shining through',
    'breaking through',
    'rising over',
    'touching',
    'illuminating',
    'brushing',
    'awakening',
    'bathing',
    'dancing over',
    'unfolding in',
    'glowing in',
  ];

  const sunsetActions = [
    'cooling',
    'fading into',
    'beneath',
    'under',
    'drifting across',
    'sweeping over',
    'settling across',
    'resting on',
    'whispering through',
    'shadowing',
    'softening',
    'hiding behind',
    'lingering over',
    'veiling',
    'calming',
    'draping over',
  ];

  const weatherMoods = [
    'crisp',
    'brisk',
    'frosty',
    'chilly',
    'mild',
    'cool',
    'balmy',
    'humid',
    'dewy',
    'gentle',
    'quiet',
    'calm',
    'sharp',
    'soft',
    'misty',
    'foggy',
    'clear',
    'sunny',
    'breezy',
    'stormy',
    'rainy',
    'damp',
    'hazy',
  ];

  const sceneriesSunrise = [
    'morning air',
    'mountain mist',
    'dawn breeze',
    'early fog',
    'valley frost',
    'dewy meadows',
    'coastal winds',
    'skies',
    'autumn chill',
    'winter dawn',
    'spring drizzle',
    'alpine clouds',
  ];

  const sceneriesSunset = [
    'evening breeze',
    'night mist',
    'twilight chill',
    'coastal fog',
    'valley haze',
    'dusk clouds',
    'starry skies',
    'gentle rain',
    'autumn air',
    'winter twilight',
    'ocean gale',
    'quiet shadows',
  ];

  const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
  const actions = isSunrise ? sunriseActions : sunsetActions;
  const sceneries = isSunrise ? sceneriesSunrise : sceneriesSunset;

  const patterns = [
    // 3 words:
    () => `${pick(actions.filter((a) => !a.includes(' ')))} ${pick(weatherMoods)} air`,
    () => `${pick(actions.filter((a) => !a.includes(' ')))} ${pick(sceneries)}`,
    () => `under ${pick(weatherMoods)} skies`,
    () => `beneath ${pick(weatherMoods)} skies`,
    // 4 words:
    () =>
      `${pick(actions.filter((a) => !a.includes(' ')))} ${pick(weatherMoods)} ${pick(sceneries)}`,
    () => `${pick(actions.filter((a) => a.includes(' ')))} ${pick(weatherMoods)} mist`,
    () => `under ${pick(weatherMoods)} ${pick(sceneries)}`,
    () => `beneath ${pick(weatherMoods)} ${pick(sceneries)}`,
    () => `across ${pick(weatherMoods)} ${pick(sceneries)}`,
    // 5 words:
    () =>
      `${pick(actions.filter((a) => a.includes(' ')))} ${pick(weatherMoods)} ${pick(sceneries)}`,
    () =>
      `${pick(actions.filter((a) => !a.includes(' ')))} ${pick(weatherMoods)} ${pick(weatherMoods)} ${pick(sceneries)}`,
  ];

  let phrase = pick(patterns)();
  const words = phrase.trim().split(/\s+/);
  if (words.length < 3) {
    phrase = `${phrase} skies`;
  } else if (words.length > 5) {
    phrase = words.slice(0, 5).join(' ');
  }
  return phrase;
}

export function generateColor(slotType: 'morning' | 'evening' | 'random' = 'random'): ColorData {
  const isMorning =
    slotType === 'morning' ? true : slotType === 'evening' ? false : Math.random() > 0.5;
  const list = isMorning ? SUNRISE_PALETTES : SUNSET_PALETTES;
  const choice = list[Math.floor(Math.random() * list.length)];

  // Slight subtle randomized variation so we don't repeat the exact same hex
  const baseRgb = hexToRgb(choice.hex);
  const jitter = () => Math.round((Math.random() - 0.5) * 12);
  const r = Math.max(0, Math.min(255, baseRgb.r + jitter()));
  const g = Math.max(0, Math.min(255, baseRgb.g + jitter()));
  const b = Math.max(0, Math.min(255, baseRgb.b + jitter()));
  const hex = rgbToHex(r, g, b);

  const rgb = { r, g, b };
  const hsl = rgbToHsl(r, g, b);
  const cmyk = rgbToCmyk(r, g, b);
  const companions = generateCompanionColors(hex);
  const swatchBar = generateSwatchBar(hex);
  const contrastText = getContrastTextColor(r, g, b);

  const weatherDesc = generateWeatherDescription(isMorning);
  const colorPick = choice.colorPick || choice.name;
  const weatherTweet = `${colorPick} ${weatherDesc} #eternal #colors`;

  return {
    id: `col_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    name: choice.name,
    colorPick,
    hex,
    rgb,
    hsl,
    cmyk,
    mood: choice.mood,
    weatherDesc,
    weatherTweet,
    slotType: isMorning ? 'morning' : 'evening',
    companions,
    swatchBar,
    contrastText,
  };
}

export const DEFAULT_TWEET_TEMPLATE = '{color_pick} {weather_desc} #eternal #colors';

export function formatTweetText(template: string, color: ColorData, slotLabel?: string): string {
  return substituteTemplate(template, color, {
    slotLabel,
    fallbackWeatherDesc: () => generateWeatherDescription(color.slotType === 'morning'),
  });
}
