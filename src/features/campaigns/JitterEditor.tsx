/**
 * X ChromaBot - JitterEditor
 * Campaign form section: humanized random delay toggle and window slider.
 */

import React from 'react';
import { UserCheck } from 'lucide-react';

interface JitterEditorProps {
  humanizeJitterEnabled: boolean;
  jitterPercentage: number;
  onChange: (patch: { humanizeJitterEnabled?: boolean; jitterPercentage?: number }) => void;
}

export const JitterEditor: React.FC<JitterEditorProps> = ({
  humanizeJitterEnabled,
  jitterPercentage,
  onChange,
}) => (
  <div className="pt-4 border-t border-neutral-200 dark:border-neutral-800 space-y-3">
    <div className="flex items-center justify-between">
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={humanizeJitterEnabled}
          onChange={(e) => onChange({ humanizeJitterEnabled: e.target.checked })}
          className="h-4 w-4 rounded border-neutral-300 text-neutral-900 focus:ring-neutral-500"
        />
        <span className="text-xs font-bold uppercase tracking-wider text-neutral-800 dark:text-neutral-200 flex items-center gap-1.5">
          <UserCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
          Humanized Timing Delay (Randomized 0 to +{jitterPercentage}%)
        </span>
      </label>

      <span className="text-[11px] font-mono font-medium px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300">
        {humanizeJitterEnabled ? `Active (0 to +${jitterPercentage}%)` : 'Disabled (Clockwork)'}
      </span>
    </div>

    <p className="text-xs text-neutral-500 leading-relaxed">
      Adds a randomized human-like delay from 0 seconds up to {jitterPercentage}% of each repeat
      window. This breaks rigid mathematical robotic posting patterns on X and mimics genuine human
      intervals.
    </p>

    {humanizeJitterEnabled && (
      <div className="bg-neutral-50 dark:bg-neutral-950 p-3.5 rounded-lg border border-neutral-200 dark:border-neutral-800 space-y-3">
        <div className="flex items-center justify-between text-xs">
          <span className="text-neutral-600 dark:text-neutral-400 font-medium">
            Maximum Random Delay Window:
          </span>
          <span className="font-mono font-bold text-neutral-900 dark:text-neutral-100">
            +{jitterPercentage}% of repeat window
          </span>
        </div>

        <div className="flex items-center gap-3">
          <input
            type="range"
            min="5"
            max="35"
            step="5"
            value={jitterPercentage}
            onChange={(e) => onChange({ jitterPercentage: Number(e.target.value) })}
            className="w-full h-1.5 bg-neutral-200 dark:bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-neutral-900 dark:accent-neutral-100"
          />
          <span className="text-xs font-mono font-bold w-12 text-right">{jitterPercentage}%</span>
        </div>

        <div className="text-[11px] text-neutral-500 font-mono flex flex-wrap gap-x-4 gap-y-1 pt-1">
          <span>
            1m test: <strong>0 - {Math.round(60 * (jitterPercentage / 100))}s delay</strong>
          </span>
          <span>
            15m cycle:{' '}
            <strong>0 - {Math.round((15 * 60 * (jitterPercentage / 100)) / 60)}m delay</strong>
          </span>
          <span>
            1h cycle: <strong>0 - {Math.round(60 * (jitterPercentage / 100))}m delay</strong>
          </span>
        </div>
      </div>
    )}
  </div>
);
