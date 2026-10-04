/**
 * X ChromaBot - TemplateField
 * Tweet text template editor with AI presets, token shortcuts and live AI test.
 */

import React from 'react';
import { Sparkles } from 'lucide-react';
import { LABEL_CLASS } from './constants.js';

interface TemplateFieldProps {
  template: string;
  onChange: (template: string) => void;
  testingAi: boolean;
  aiPreviewResult: string | null;
  onTestAi: () => void;
}

const PRESETS = [
  {
    label: '📜 Neruda Arc with History',
    template:
      '<history><agent>consider what has already been said and respond with just the body of a tweet that is unique pablo neruda like expression that plays on the series thats been written thus far</agent></history>',
    className:
      'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-800 hover:bg-amber-100',
  },
  {
    label: '✍️ Neruda Solo Poem',
    template:
      '<agent>respond with just the body of a tweet that is unique pablo neruda like expression</agent>',
    className:
      'bg-purple-50 dark:bg-purple-950/40 text-purple-800 dark:text-purple-300 border-purple-300 dark:border-purple-800 hover:bg-purple-100',
  },
  {
    label: '✨ Swatch + History Arc',
    template:
      '{color_pick} {hex} | <history><agent>Write a visceral 2-line Neruda-style poem connecting this new hue to previous drops</agent></history> #eternal #colors',
    className:
      'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-800 dark:text-indigo-300 border-indigo-300 dark:border-indigo-800 hover:bg-indigo-100',
  },
];

const CHIP =
  'bg-neutral-100 dark:bg-neutral-800 px-1 py-0.5 rounded text-neutral-600 dark:text-neutral-300';

export const TemplateField: React.FC<TemplateFieldProps> = ({
  template,
  onChange,
  testingAi,
  aiPreviewResult,
  onTestAi,
}) => (
  <div className="space-y-2">
    <div className="flex items-center justify-between">
      <label className={LABEL_CLASS}>Tweet Text Template</label>
      <button
        type="button"
        onClick={onTestAi}
        disabled={testingAi}
        className="text-[11px] font-semibold text-purple-600 dark:text-purple-400 hover:text-purple-700 flex items-center gap-1 cursor-pointer disabled:opacity-50"
      >
        {testingAi ? (
          <span className="w-2.5 h-2.5 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
        ) : (
          <Sparkles className="w-3 h-3 text-purple-500" />
        )}
        <span>Test AI Generation</span>
      </button>
    </div>

    <textarea
      rows={3}
      value={template}
      onChange={(e) => onChange(e.target.value)}
      placeholder="{color_pick} {weather_desc} #eternal #colors"
      className="w-full px-3 py-2 font-mono rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 leading-relaxed text-xs"
    />

    <div className="space-y-1">
      <span className="text-[10px] uppercase font-mono text-neutral-400 font-semibold">
        AI Poetry Presets (Gemini):
      </span>
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => onChange(p.template)}
            className={`px-2 py-0.5 text-[11px] font-medium rounded border cursor-pointer ${p.className}`}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>

    <div className="flex flex-wrap items-center gap-1 text-[10px] text-neutral-400 font-mono">
      <span>Tokens:</span>
      <button
        type="button"
        onClick={() => onChange(`${template} <agent>Write a poetic expression</agent>`)}
        className="bg-purple-100 dark:bg-purple-900/60 px-1 py-0.5 rounded text-purple-700 dark:text-purple-300 cursor-pointer"
      >
        + &lt;agent&gt;
      </button>
      <button
        type="button"
        onClick={() =>
          onChange(`${template} <history><agent>Consider prior tweets...</agent></history>`)
        }
        className="bg-amber-100 dark:bg-amber-900/60 px-1 py-0.5 rounded text-amber-700 dark:text-amber-300 cursor-pointer"
      >
        + &lt;history&gt;&lt;agent&gt;
      </button>
      <span className={CHIP}>{'{color_pick}'}</span>
      <span className={CHIP}>{'{hex}'}</span>
      <span className={CHIP}>{'{mood}'}</span>
    </div>

    {aiPreviewResult && (
      <div className="p-2.5 bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800 rounded-lg text-xs space-y-1">
        <div className="font-semibold text-purple-800 dark:text-purple-300 text-[11px] flex items-center justify-between">
          <span>Live AI Output:</span>
          <span className="font-mono">{aiPreviewResult.length} / 280</span>
        </div>
        <p className="text-neutral-800 dark:text-neutral-200 leading-relaxed font-sans">
          {aiPreviewResult}
        </p>
      </div>
    )}
  </div>
);
