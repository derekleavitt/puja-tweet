import React, { useState } from 'react';
import { Save, Check, ExternalLink, RefreshCw, Power } from 'lucide-react';
import { BotSettings } from '../types.js';
import { extractTweetId } from './TargetTweetEditor.js';

interface SettingsPanelProps {
  settings: BotSettings;
  onSaveSettings: (newSettings: Partial<BotSettings>) => Promise<void>;
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

export const SettingsPanel: React.FC<SettingsPanelProps> = ({ settings, onSaveSettings }) => {
  const [targetTweetId, setTargetTweetId] = useState(settings.targetTweetId);
  const [scheduleTimes, setScheduleTimes] = useState(settings.scheduleTimes.join(', '));
  const [timezone, setTimezone] = useState(settings.timezone);
  const [schedulerEnabled, setSchedulerEnabled] = useState(settings.schedulerEnabled);
  const [dryRun, setDryRun] = useState(settings.dryRun);
  const [template, setTemplate] = useState(settings.template);
  const [isSaving, setIsSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const times = scheduleTimes
        .split(',')
        .map((t) => t.trim())
        .filter((t) => /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(t));

      const cleanedTargetId = extractTweetId(targetTweetId) || targetTweetId.trim();

      await onSaveSettings({
        targetTweetId: cleanedTargetId,
        scheduleTimes: times.length > 0 ? times : ['06:00', '18:00'],
        timezone,
        schedulerEnabled,
        dryRun,
        template,
      });

      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 2500);
    } finally {
      setIsSaving(false);
    }
  };

  const insertToken = (token: string) => {
    setTemplate((prev) => `${prev} ${token}`);
  };

  return (
    <div className="max-w-4xl space-y-6">
      <div className="pb-4 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
            Schedule & Template Configuration
          </h2>
          <p className="text-sm text-neutral-500 mt-0.5">
            Configure target post reply settings, daily execution times, and tweet copywriting variables.
          </p>
        </div>

        {savedSuccess && (
          <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1.5 bg-emerald-50 dark:bg-emerald-950/40 px-3 py-1 rounded-md border border-emerald-200 dark:border-emerald-800">
            <Check className="w-3.5 h-3.5" /> Settings Saved
          </span>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Target Tweet ID */}
        <div className="border border-neutral-200 dark:border-neutral-800 rounded-xl p-5 bg-white dark:bg-neutral-900 space-y-3 shadow-xs">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold uppercase tracking-wider text-neutral-700 dark:text-neutral-300">
              Target Tweet ID / Status
            </label>
            <a
              href={`https://x.com/i/status/${extractTweetId(targetTweetId) || targetTweetId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1 font-mono"
            >
              Verify Target on X <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          <p className="text-xs text-neutral-500">
            Paste a numeric Tweet ID or a full post URL (e.g. <span className="font-mono">https://x.com/username/status/2103110008212992249</span>).
          </p>

          <input
            type="text"
            value={targetTweetId}
            onChange={(e) => setTargetTweetId(e.target.value)}
            placeholder="2103110008212992249 or https://x.com/..."
            className="w-full px-3.5 py-2 text-sm font-mono border border-neutral-300 dark:border-neutral-700 rounded-lg bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-400 dark:focus:ring-neutral-600"
            required
          />

          {extractTweetId(targetTweetId) && extractTweetId(targetTweetId) !== targetTweetId && (
            <div className="text-xs text-emerald-600 dark:text-emerald-400 font-mono">
              ✓ Clean ID detected: {extractTweetId(targetTweetId)}
            </div>
          )}
        </div>

        {/* Schedule Times & Timezone */}
        <div className="border border-neutral-200 dark:border-neutral-800 rounded-xl p-5 bg-white dark:bg-neutral-900 grid grid-cols-1 md:grid-cols-2 gap-5 shadow-xs">
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
              onChange={(e) => setScheduleTimes(e.target.value)}
              placeholder="06:00, 18:00"
              className="w-full px-3.5 py-2 text-sm font-mono border border-neutral-300 dark:border-neutral-700 rounded-lg bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-400 dark:focus:ring-neutral-600"
              required
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-neutral-700 dark:text-neutral-300">
              Timezone
            </label>
            <p className="text-xs text-neutral-500">
              Determines when 6:00 AM and 6:00 PM occur.
            </p>
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
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

        {/* Toggles: Active/Paused & Dry-Run */}
        <div className="border border-neutral-200 dark:border-neutral-800 rounded-xl p-5 bg-white dark:bg-neutral-900 grid grid-cols-1 md:grid-cols-2 gap-4 shadow-xs">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={schedulerEnabled}
              onChange={(e) => setSchedulerEnabled(e.target.checked)}
              className="mt-1 h-4 w-4 rounded border-neutral-300 text-neutral-900 focus:ring-neutral-500"
            />
            <div>
              <div className="font-semibold text-sm text-neutral-900 dark:text-neutral-100">
                Automated Background Scheduler
              </div>
              <p className="text-xs text-neutral-500">
                When active, the server monitors clock ticks and automatically fires replies at 6am & 6pm.
              </p>
            </div>
          </label>

          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={dryRun}
              onChange={(e) => setDryRun(e.target.checked)}
              className="mt-1 h-4 w-4 rounded border-neutral-300 text-neutral-900 focus:ring-neutral-500"
            />
            <div>
              <div className="font-semibold text-sm text-neutral-900 dark:text-neutral-100">
                Dry Run Simulation Mode
              </div>
              <p className="text-xs text-neutral-500">
                Simulates posts locally without consuming X API monthly tweet quotas.
              </p>
            </div>
          </label>
        </div>

        {/* Tweet Template Editor */}
        <div className="border border-neutral-200 dark:border-neutral-800 rounded-xl p-5 bg-white dark:bg-neutral-900 space-y-3 shadow-xs">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold uppercase tracking-wider text-neutral-700 dark:text-neutral-300">
              Tweet Text Template (280 char limit)
            </label>
            <span className="text-xs text-neutral-400 font-mono">
              Available variables below
            </span>
          </div>

          <textarea
            rows={6}
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            className="w-full px-3.5 py-2.5 text-xs font-mono border border-neutral-300 dark:border-neutral-700 rounded-lg bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-400 dark:focus:ring-neutral-600 leading-relaxed"
            required
          />

          {/* Variable chips */}
          <div className="space-y-1.5 pt-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-neutral-500">Insert Variable Token:</span>
              <button
                type="button"
                onClick={() => setTemplate('{color_pick} {weather_desc} #eternal #colors')}
                className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline font-medium cursor-pointer"
              >
                Reset to Weather Formula
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {[
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
              ].map((token) => (
                <button
                  type="button"
                  key={token}
                  onClick={() => insertToken(token)}
                  className={`px-2 py-0.5 text-xs font-mono rounded transition-colors cursor-pointer ${
                    ['{color_pick}', '{weather_desc}', '{weather_tweet}'].includes(token)
                      ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200 dark:border-blue-800'
                      : 'bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-neutral-800 dark:text-neutral-200'
                  }`}
                >
                  + {token}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Submit */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="submit"
            disabled={isSaving}
            className="px-5 py-2 text-sm font-semibold text-white bg-neutral-900 hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200 rounded-lg transition-colors flex items-center gap-2 cursor-pointer shadow-xs disabled:opacity-50"
          >
            {isSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Settings
          </button>
        </div>
      </form>
    </div>
  );
};
