/**
 * X ChromaBot - TemplateEditor
 * Shared tweet template editor: textarea, AI presets, token shortcuts and live AI test.
 * Used by the settings panel and the campaign form.
 */

import React from 'react';
import { Sparkles } from 'lucide-react';
import { TEMPLATE_TOKENS } from '../../shared/template/substitute.js';
import { useTemplatePreview } from '../hooks/useTemplatePreview.js';
import { AGENT_SNIPPETS, DEFAULT_TEMPLATE, TEMPLATE_PRESETS } from './templatePresets.js';

interface TemplateEditorProps {
  template: string;
  onChange: (template: string) => void;
  /** Campaign whose history the server should use when testing agent tags. */
  contextId?: string;
  rows?: number;
  required?: boolean;
}

const HIGHLIGHTED_TOKENS: readonly string[] = ['{color_pick}', '{weather_desc}', '{weather_tweet}'];
const LABEL = 'text-[11px] font-semibold text-neutral-500';

export const TemplateEditor: React.FC<TemplateEditorProps> = ({
  template,
  onChange,
  contextId,
  rows = 5,
  required = false,
}) => {
  const { testing, result, test } = useTemplatePreview(template, contextId);
  const append = (snippet: string) => onChange(`${template} ${snippet}`);
  const hasAgentTag = /<agent>/i.test(template);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-xs font-bold uppercase tracking-wider text-neutral-700 dark:text-neutral-300">
          Tweet Text Template (280 char limit)
        </label>
        <span className="text-xs text-neutral-400 font-mono">Available variables below</span>
      </div>

      <textarea
        rows={rows}
        value={template}
        onChange={(e) => onChange(e.target.value)}
        placeholder={DEFAULT_TEMPLATE}
        className="w-full px-3.5 py-2.5 text-xs font-mono border border-neutral-300 dark:border-neutral-700 rounded-lg bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-400 dark:focus:ring-neutral-600 leading-relaxed"
        required={required}
      />

      <div className="space-y-1.5">
        <span className={`${LABEL} flex items-center gap-1.5`}>
          <Sparkles className="w-3.5 h-3.5 text-amber-500" />
          <span>AI Poetry Agent Presets (Gemini Engine):</span>
        </span>
        <div className="flex flex-wrap gap-2">
          {TEMPLATE_PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => onChange(p.template)}
              className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors cursor-pointer text-left ${p.className}`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1">
        <span className={LABEL}>Insert AI Agent Expressions:</span>
        <div className="flex flex-wrap gap-1.5">
          {AGENT_SNIPPETS.map((s) => (
            <button
              key={s.label}
              type="button"
              onClick={() => append(s.snippet)}
              className={`px-2 py-0.5 text-xs font-mono rounded border transition-colors cursor-pointer ${s.className}`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1 pt-1">
        <div className="flex items-center justify-between">
          <span className={LABEL}>Insert Variable Token:</span>
          <button
            type="button"
            onClick={() => onChange(DEFAULT_TEMPLATE)}
            className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline font-medium cursor-pointer"
          >
            Reset to Default Formula
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {TEMPLATE_TOKENS.map((token) => (
            <button
              type="button"
              key={token}
              onClick={() => append(token)}
              className={`px-2 py-0.5 text-xs font-mono rounded transition-colors cursor-pointer ${
                HIGHLIGHTED_TOKENS.includes(token)
                  ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200 dark:border-blue-800'
                  : 'bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-neutral-800 dark:text-neutral-200'
              }`}
            >
              + {token}
            </button>
          ))}
        </div>
      </div>

      <div className="pt-2 border-t border-neutral-100 dark:border-neutral-800 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-neutral-700 dark:text-neutral-300 flex items-center gap-1.5">
            {hasAgentTag && <span className="w-2 h-2 rounded-full bg-purple-500 animate-pulse" />}
            <span>Live Preview &amp; Agent Test</span>
          </span>
          <button
            type="button"
            onClick={test}
            disabled={testing}
            className="px-3 py-1 text-xs font-semibold rounded-md bg-purple-600 hover:bg-purple-700 text-white transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-xs"
          >
            {testing ? (
              <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <Sparkles className="w-3 h-3" />
            )}
            <span>Test AI Generation Now</span>
          </button>
        </div>

        {result && (
          <div className="p-3 bg-purple-50/60 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800/80 rounded-lg text-xs space-y-1">
            <div className="font-semibold text-purple-900 dark:text-purple-200 flex items-center justify-between">
              <span>Generated Tweet Preview:</span>
              <span className="font-mono text-[11px] text-purple-700 dark:text-purple-400">
                {result.length} / 280 chars
              </span>
            </div>
            <div className="font-sans text-neutral-800 dark:text-neutral-200 whitespace-pre-line leading-relaxed">
              {result}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
