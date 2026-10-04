/**
 * X ChromaBot - ScheduleEditor
 * Form section: repetition mode, interval / fixed clock times, timezone, jitter.
 */

import React, { useState } from 'react';
import { Flame } from 'lucide-react';
import { TweetContext } from '../../types.js';
import { DEFAULT_TIMEZONE, timezoneOptions } from '../../../shared/time.js';
import { FIELD_CLASS, INTERVAL_PRESETS, LABEL_CLASS } from './constants.js';
import { invalidTimes, normalizeHHmm, parseTimesList } from './schedule.js';

type Schedule = TweetContext['schedule'];

interface ScheduleEditorProps {
  schedule?: Schedule;
  onChange: (fields: Partial<Schedule>) => void;
}

const MODE_ON =
  'border-indigo-600 bg-indigo-50/50 dark:bg-indigo-950/40 text-indigo-900 dark:text-indigo-100 font-semibold';
const MODE_OFF =
  'border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300';

export const ScheduleEditor: React.FC<ScheduleEditorProps> = ({ schedule, onChange }) => {
  const [timesText, setTimesText] = useState((schedule?.scheduleTimes || []).join(', '));
  const bad = invalidTimes(schedule?.scheduleTimes || []);

  const handleTimes = (raw: string) => {
    setTimesText(raw);
    onChange({ scheduleTimes: parseTimesList(raw) });
  };

  const handleTimesBlur = () => {
    const times = parseTimesList(timesText).map((t) => normalizeHHmm(t) ?? t);
    setTimesText(times.join(', '));
    onChange({ scheduleTimes: times });
  };

  return (
    <>
      <div className="space-y-2 pt-2 border-t border-neutral-100 dark:border-neutral-800">
        <label className={LABEL_CLASS}>Repetition Mode</label>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onChange({ mode: 'interval' })}
            className={`p-2.5 rounded-lg border text-left cursor-pointer transition-colors ${
              schedule?.mode === 'interval' ? MODE_ON : MODE_OFF
            }`}
          >
            <div>Repeating Interval</div>
            <div className="text-[10px] text-neutral-500 font-normal">Every X minutes or hours</div>
          </button>
          <button
            type="button"
            onClick={() => onChange({ mode: 'fixed_times' })}
            className={`p-2.5 rounded-lg border text-left cursor-pointer transition-colors ${
              schedule?.mode === 'fixed_times' ? MODE_ON : MODE_OFF
            }`}
          >
            <div>Fixed Clock Drops</div>
            <div className="text-[10px] text-neutral-500 font-normal">
              e.g. 6:00 AM &amp; 6:00 PM
            </div>
          </button>
        </div>
      </div>

      {schedule?.mode === 'interval' && (
        <div className="space-y-1.5">
          <label className={LABEL_CLASS}>Interval Frequency</label>
          <select
            value={schedule.intervalMinutes || 60}
            onChange={(e) => onChange({ intervalMinutes: parseInt(e.target.value, 10) })}
            className={FIELD_CLASS}
          >
            {INTERVAL_PRESETS.map((p) => (
              <option key={p.minutes} value={p.minutes}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {schedule?.mode === 'fixed_times' && (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className={LABEL_CLASS}>Times (comma separated, HH:mm)</label>
            <input
              type="text"
              value={timesText}
              onChange={(e) => handleTimes(e.target.value)}
              onBlur={handleTimesBlur}
              placeholder="06:00, 18:00"
              className={`${FIELD_CLASS} font-mono`}
            />
            {bad.length > 0 && (
              <p className="text-[11px] text-red-600 dark:text-red-400">
                Invalid: {bad.join(', ')} (use 24-hour HH:mm)
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <label className={LABEL_CLASS}>Timezone</label>
            <select
              value={schedule.timezone || 'America/Denver'}
              onChange={(e) => onChange({ timezone: e.target.value })}
              className={FIELD_CLASS}
            >
              {timezoneOptions(schedule.timezone || DEFAULT_TIMEZONE).map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      <div className="p-3 rounded-lg bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-200/80 dark:border-neutral-700 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Flame className="w-3.5 h-3.5 text-amber-500" />
            <span className="font-semibold text-neutral-800 dark:text-neutral-200">
              Anti-Bot Humanized Timing Delay
            </span>
          </div>
          <input
            type="checkbox"
            checked={schedule?.humanizeJitterEnabled ?? true}
            onChange={(e) => onChange({ humanizeJitterEnabled: e.target.checked })}
            className="rounded text-indigo-600 focus:ring-indigo-500"
          />
        </div>
        <p className="text-[11px] text-neutral-500">
          Adds a random delay (0 to {schedule?.jitterPercentage ?? 25}%) so replies don't post at
          exact mathematical minute marks.
        </p>
      </div>
    </>
  );
};
