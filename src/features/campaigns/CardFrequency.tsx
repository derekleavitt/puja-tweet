/**
 * X ChromaBot - CardFrequency
 * Per-campaign frequency readout and one-click interval presets.
 */

import React from 'react';
import { Clock } from 'lucide-react';
import { TweetContext } from '../../types.js';
import { formatHHmm12h, tzAbbreviation } from '../../../shared/time.js';

interface CardFrequencyProps {
  context: TweetContext;
  countdown?: string;
  onUpdate: (updates: Partial<TweetContext>) => Promise<void>;
}

const QUICK_PRESETS = [
  { label: '1m', minutes: 1 },
  { label: '15m', minutes: 15 },
  { label: '30m', minutes: 30 },
  { label: '1h', minutes: 60 },
  { label: '3h', minutes: 180 },
  { label: '6h', minutes: 360 },
  { label: '12h', minutes: 720 },
  { label: '24h', minutes: 1440 },
];

const CHIP_BASE =
  'px-2 py-0.5 text-[11px] font-mono font-medium rounded-md border transition-colors cursor-pointer';
const CHIP_ON = 'bg-indigo-600 text-white border-indigo-600 shadow-xs';
const CHIP_OFF =
  'bg-white dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 border-neutral-200 dark:border-neutral-700 hover:border-neutral-300 dark:hover:border-neutral-600 hover:bg-neutral-100 dark:hover:bg-neutral-700';

export const CardFrequency: React.FC<CardFrequencyProps> = ({
  context: ctx,
  countdown,
  onUpdate,
}) => {
  const fixedTimes = ctx.schedule.scheduleTimes || [];
  const zone = tzAbbreviation(new Date(), ctx.schedule.timezone);
  const fixedLabel = fixedTimes.length > 0 ? fixedTimes.map(formatHHmm12h).join(' / ') : 'Fixed';
  return (
    <div className="p-2.5 rounded-lg bg-neutral-50 dark:bg-neutral-800/40 border border-neutral-200/80 dark:border-neutral-700/60 space-y-2 text-xs">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-neutral-700 dark:text-neutral-200 font-medium">
          <Clock className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
          <span>Campaign Frequency:</span>
          <span className="text-indigo-600 dark:text-indigo-400 font-mono text-[11px]">
            {ctx.schedule.mode === 'interval'
              ? `Every ${ctx.schedule.intervalMinutes}m`
              : `${fixedTimes.map(formatHHmm12h).join(', ')} ${zone}`}
          </span>
        </div>

        <div className="flex items-center gap-1 text-[11px] font-mono text-neutral-500">
          <span>Next:</span>
          <span className="font-semibold text-neutral-800 dark:text-neutral-200">
            {ctx.enabled ? countdown || 'Calculating...' : 'Paused'}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        {QUICK_PRESETS.map((preset) => {
          const isSelected =
            ctx.schedule.mode === 'interval' && ctx.schedule.intervalMinutes === preset.minutes;
          return (
            <button
              key={preset.label}
              type="button"
              onClick={() =>
                onUpdate({
                  schedule: { ...ctx.schedule, mode: 'interval', intervalMinutes: preset.minutes },
                })
              }
              className={`${CHIP_BASE} ${isSelected ? CHIP_ON : CHIP_OFF}`}
            >
              {preset.label}
            </button>
          );
        })}

        <button
          type="button"
          onClick={() =>
            onUpdate({
              schedule: {
                ...ctx.schedule,
                mode: 'fixed_times',
              },
            })
          }
          className={`${CHIP_BASE} ${ctx.schedule.mode === 'fixed_times' ? CHIP_ON : CHIP_OFF}`}
          title={`Post daily at ${fixedLabel} ${zone} (this campaign's fixed clock times)`}
        >
          {fixedLabel}
        </button>
      </div>
    </div>
  );
};
