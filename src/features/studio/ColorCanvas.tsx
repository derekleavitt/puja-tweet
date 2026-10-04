/**
 * X ChromaBot - ColorCanvas
 * Swatch hero, color metrics and companion palette bar.
 */

import React from 'react';
import { Check, Copy } from 'lucide-react';
import { ColorData } from '../../types.js';

interface ColorCanvasProps {
  color: ColorData;
  slotBadge: string;
  copiedField: string | null;
  onCopy: (text: string, fieldName: string) => void;
}

export const ColorCanvas: React.FC<ColorCanvasProps> = ({
  color,
  slotBadge,
  copiedField,
  onCopy,
}) => (
  <div className="border border-neutral-200 dark:border-neutral-800 rounded-xl overflow-hidden bg-white dark:bg-neutral-900 shadow-xs">
    {/* Color Canvas Header Swatch */}
    <div
      className="h-56 w-full p-6 flex flex-col justify-between transition-colors duration-500 relative"
      style={{ backgroundColor: color.hex }}
    >
      <div className="flex items-center justify-between">
        <span
          className="px-2.5 py-1 text-xs font-mono font-medium rounded-md shadow-xs backdrop-blur-md"
          style={{
            backgroundColor:
              color.contrastText === '#000000' ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.5)',
            color: color.contrastText === '#000000' ? '#111' : '#fff',
          }}
        >
          {slotBadge}
        </span>

        <button
          onClick={() => onCopy(color.hex, 'hex-canvas')}
          className="px-2.5 py-1 text-xs font-mono font-semibold rounded-md shadow-xs backdrop-blur-md flex items-center gap-1 cursor-pointer"
          style={{
            backgroundColor:
              color.contrastText === '#000000' ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.5)',
            color: color.contrastText === '#000000' ? '#111' : '#fff',
          }}
        >
          {copiedField === 'hex-canvas' ? (
            <Check className="w-3.5 h-3.5 text-emerald-600" />
          ) : (
            <Copy className="w-3.5 h-3.5" />
          )}
          {color.hex}
        </button>
      </div>

      {/* Big Display Name */}
      <div style={{ color: color.contrastText }}>
        <h2 className="text-3xl font-extrabold tracking-tight drop-shadow-xs">{color.name}</h2>
        <p className="text-sm opacity-90 font-medium max-w-lg mt-1 line-clamp-2">"{color.mood}"</p>
      </div>
    </div>

    {/* Color Metrics Grid */}
    <div className="p-6 grid grid-cols-2 sm:grid-cols-4 gap-4 border-b border-neutral-200 dark:border-neutral-800 text-xs">
      <div className="space-y-1">
        <span className="text-neutral-500 uppercase font-semibold text-[10px] tracking-wider">
          HEX Code
        </span>
        <div className="font-mono font-bold text-neutral-900 dark:text-neutral-100 flex items-center gap-1.5 tabular-nums">
          <span
            className="w-3 h-3 rounded-full inline-block border border-neutral-300 dark:border-neutral-700"
            style={{ backgroundColor: color.hex }}
          />
          {color.hex}
        </div>
      </div>

      <div className="space-y-1">
        <span className="text-neutral-500 uppercase font-semibold text-[10px] tracking-wider">
          RGB Values
        </span>
        <div className="font-mono text-neutral-900 dark:text-neutral-100 tabular-nums">
          {color.rgb.r}, {color.rgb.g}, {color.rgb.b}
        </div>
      </div>

      <div className="space-y-1">
        <span className="text-neutral-500 uppercase font-semibold text-[10px] tracking-wider">
          HSL Profile
        </span>
        <div className="font-mono text-neutral-900 dark:text-neutral-100 tabular-nums">
          {color.hsl.h}°, {color.hsl.s}%, {color.hsl.l}%
        </div>
      </div>

      <div className="space-y-1">
        <span className="text-neutral-500 uppercase font-semibold text-[10px] tracking-wider">
          CMYK Print
        </span>
        <div className="font-mono text-neutral-900 dark:text-neutral-100 tabular-nums">
          {color.cmyk.c}, {color.cmyk.m}, {color.cmyk.y}, {color.cmyk.k}
        </div>
      </div>
    </div>

    {/* Harmonious Companions Bar */}
    <div className="p-6">
      <div className="flex items-center justify-between mb-3 text-xs">
        <span className="font-semibold text-neutral-700 dark:text-neutral-300">
          Harmonious Palette Bar
        </span>
        <span className="text-neutral-400 font-mono text-[11px]">
          Analogous · Triad · Complementary
        </span>
      </div>

      <div className="grid grid-cols-5 gap-2 h-12 rounded-lg overflow-hidden border border-neutral-200 dark:border-neutral-800">
        <div
          className="flex items-end justify-center pb-1 text-[10px] font-mono font-bold transition-transform hover:scale-105"
          style={{ backgroundColor: color.hex, color: color.contrastText }}
          title={`Primary: ${color.hex}`}
        >
          Base
        </div>
        {color.companions.map((compHex, idx) => (
          <div
            key={idx}
            onClick={() => onCopy(compHex, `comp-${idx}`)}
            className="flex items-end justify-center pb-1 text-[10px] font-mono cursor-pointer transition-transform hover:scale-105"
            style={{ backgroundColor: compHex, color: '#FFFFFF' }}
            title={`Click to copy: ${compHex}`}
          >
            {copiedField === `comp-${idx}` ? 'Copied' : compHex}
          </div>
        ))}
      </div>
    </div>
  </div>
);
