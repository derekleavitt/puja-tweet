/**
 * X ChromaBot - ScheduleSettings
 * Repeat timing mode (interval vs fixed clock times) plus the jitter control.
 */

import React from 'react';
import { Check, Clock, Repeat } from 'lucide-react';
import { JitterSettings } from './JitterSettings.js';

export interface ScheduleValues {
  intervalMode: 'fixed_times' | 'interval';
  intervalMinutes: number;
  scheduleTimes: string;
  timezone: string;
  humanizeJitterEnabled: boolean;
  jitterPercentage: number;
}

interface ScheduleSettingsProps {
  value: ScheduleValues;
  onChange: (patch: Partial<ScheduleValues>) => void;
}

const COMMON_TIMEZONES = [
  'MST',
  'America/Denver',
  'America/Los_Angeles',
  'America/Chicago',
  'America/New_York',
  'America/Phoenix',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Australia/Sydney',
  'UTC',
];

const INTERVAL_PRESETS = [
  { label: 'Every 1 minute (Fast Test)', value: 1 },
  { label: 'Every 15 minutes', value: 15 },
  { label: 'Every 30 minutes', value: 30 },
  { label: 'Every 60 minutes (1 Hour)', value: 60 },
  { label: 'Every 3 hours', value: 180 },
  { label: 'Every 6 hours', value: 360 },
  { label: 'Every 9 hours', value: 540 },
  { label: 'Every 12 hours (Twice Daily)', value: 720 },
];

export const ScheduleSettings: React.FC<ScheduleSettingsProps> = ({ value, onChange }) => {
  const { intervalMode, intervalMinutes, scheduleTimes, timezone } = value;
  return (
    <div className="border border-neutral-200 dark:border-neutral-800 rounded-xl p-5 bg-white dark:bg-neutral-900 space-y-5 shadow-xs">
      <div className="flex items-center justify-between border-b border-neutral-200 dark:border-neutral-800 pb-3">
        <span className="text-xs font-bold uppercase tracking-wider text-neutral-700 dark:text-neutral-300 flex items-center gap-2">
          <Clock className="w-4 h-4 text-neutral-500" /> Repeat Timing Mode
        </span>
        <div className="flex items-center gap-1 bg-neutral-100 dark:bg-neutral-800 p-1 rounded-lg text-xs">
          <button
            type="button"
            onClick={() => onChange({ intervalMode: 'interval' })}
            className={`px-3 py-1 font-medium rounded-md transition-colors cursor-pointer ${
              intervalMode === 'interval'
                ? 'bg-white dark:bg-neutral-700 text-neutral-900 dark:text-neutral-100 shadow-xs'
                : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900'
            }`}
          >
            <Repeat className="w-3.5 h-3.5 inline mr-1" />
            Interval Repeat
          </button>
          <button
            type="button"
            onClick={() => onChange({ intervalMode: 'fixed_times' })}
            className={`px-3 py-1 font-medium rounded-md transition-colors cursor-pointer ${
              intervalMode === 'fixed_times'
                ? 'bg-white dark:bg-neutral-700 text-neutral-900 dark:text-neutral-100 shadow-xs'
                : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900'
            }`}
          >
            <Clock className="w-3.5 h-3.5 inline mr-1" />
            Fixed Clock Times (6am & 6pm)
          </button>
        </div>
      </div>

      {intervalMode === 'interval' ? (
        <div className="space-y-4">
          <p className="text-xs text-neutral-500">
            Choose how often ChromaBot automatically drops a new color reply. The internal server
            timer counts down and triggers a fresh post every time the interval elapses.
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {INTERVAL_PRESETS.map((preset) => {
              const isSelected = intervalMinutes === preset.value;
              return (
                <button
                  type="button"
                  key={preset.value}
                  onClick={() => onChange({ intervalMinutes: preset.value })}
                  className={`p-3 text-left rounded-xl border transition-all cursor-pointer ${
                    isSelected
                      ? 'border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-950 font-semibold shadow-xs'
                      : 'border-neutral-200 dark:border-neutral-800 hover:border-neutral-300 dark:hover:border-neutral-700 bg-neutral-50 dark:bg-neutral-950/60 text-neutral-800 dark:text-neutral-200'
                  }`}
                >
                  <div className="text-xs">{preset.label}</div>
                  <div
                    className={`text-[11px] mt-1 font-mono ${isSelected ? 'text-neutral-300 dark:text-neutral-600' : 'text-neutral-400'}`}
                  >
                    {preset.value < 60
                      ? `${preset.value} min`
                      : `${preset.value / 60} hr${preset.value === 60 ? '' : 's'}`}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="p-3 bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/40 rounded-lg text-xs text-blue-800 dark:text-blue-300 flex items-center gap-2">
            <Check className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
            <span>
              Active Repeat:{' '}
              <strong>
                Every{' '}
                {intervalMinutes < 60
                  ? `${intervalMinutes} minutes`
                  : `${intervalMinutes / 60} hours`}
              </strong>
              . The server counts down continuously.
            </span>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-neutral-700 dark:text-neutral-300">
              Daily Drop Times (24-hour format)
            </label>
            <p className="text-xs text-neutral-500">
              Comma-separated list. Defaults to 6:00 AM (06:00) and 6:00 PM (18:00).
            </p>
            <input
              type="text"
              value={scheduleTimes}
              onChange={(e) => onChange({ scheduleTimes: e.target.value })}
              placeholder="06:00, 18:00"
              className="w-full px-3.5 py-2 text-sm font-mono border border-neutral-300 dark:border-neutral-700 rounded-lg bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-400 dark:focus:ring-neutral-600"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-neutral-700 dark:text-neutral-300">
              Timezone
            </label>
            <p className="text-xs text-neutral-500">Determines when 6:00 AM and 6:00 PM occur.</p>
            <select
              value={timezone}
              onChange={(e) => onChange({ timezone: e.target.value })}
              className="w-full px-3.5 py-2 text-sm font-mono border border-neutral-300 dark:border-neutral-700 rounded-lg bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-400 dark:focus:ring-neutral-600"
            >
              {COMMON_TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      <JitterSettings
        humanizeJitterEnabled={value.humanizeJitterEnabled}
        jitterPercentage={value.jitterPercentage}
        onChange={onChange}
      />
    </div>
  );
};
