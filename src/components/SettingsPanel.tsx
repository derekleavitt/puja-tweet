import React, { useState } from 'react';
import { Save, Check, ExternalLink, RefreshCw, Clock, Repeat, Globe, Key, ShieldCheck, Sparkles, UserCheck } from 'lucide-react';
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

export const SettingsPanel: React.FC<SettingsPanelProps> = ({ settings, onSaveSettings }) => {
  const [targetTweetId, setTargetTweetId] = useState(settings.targetTweetId);
  const [intervalMode, setIntervalMode] = useState<'fixed_times' | 'interval'>(settings.intervalMode || 'fixed_times');
  const [intervalMinutes, setIntervalMinutes] = useState<number>(settings.intervalMinutes || 720);
  const [scheduleTimes, setScheduleTimes] = useState(settings.scheduleTimes.join(', '));
  const [timezone, setTimezone] = useState(settings.timezone);
  const [webhookSecret, setWebhookSecret] = useState(settings.webhookSecret || 'chroma_auto_secret');
  const [schedulerEnabled, setSchedulerEnabled] = useState(settings.schedulerEnabled);
  const [dryRun, setDryRun] = useState(settings.dryRun);
  const [template, setTemplate] = useState(settings.template);
  const [humanizeJitterEnabled, setHumanizeJitterEnabled] = useState<boolean>(settings.humanizeJitterEnabled ?? true);
  const [jitterPercentage, setJitterPercentage] = useState<number>(settings.jitterPercentage ?? 25);
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
        intervalMode,
        intervalMinutes: Number(intervalMinutes),
        scheduleTimes: times.length > 0 ? times : ['06:00', '18:00'],
        timezone,
        webhookSecret: webhookSecret.trim(),
        schedulerEnabled,
        dryRun,
        template,
        humanizeJitterEnabled,
        jitterPercentage: Number(jitterPercentage),
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

  const currentOrigin = typeof window !== 'undefined' ? window.location.origin : '';
  const webhookUrl = `${currentOrigin}/api/cron/trigger?secret=${encodeURIComponent(webhookSecret)}`;

  return (
    <div className="max-w-4xl space-y-6">
      <div className="pb-4 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
            Timing & Autonomous Reply Settings
          </h2>
          <p className="text-sm text-neutral-500 mt-0.5">
            Configure how often ChromaBot drops colors: by interval (1m, 15m, 1h, 3h, 6h, 12h) or at fixed clock times.
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
            Paste a numeric Tweet ID or a full post URL (e.g. <span className="font-mono">https://x.com/username/status/2091597504928428416</span>).
          </p>

          <input
            type="text"
            value={targetTweetId}
            onChange={(e) => setTargetTweetId(e.target.value)}
            placeholder="2091597504928428416 or https://x.com/..."
            className="w-full px-3.5 py-2 text-sm font-mono border border-neutral-300 dark:border-neutral-700 rounded-lg bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-400 dark:focus:ring-neutral-600"
            required
          />

          {extractTweetId(targetTweetId) && extractTweetId(targetTweetId) !== targetTweetId && (
            <div className="text-xs text-emerald-600 dark:text-emerald-400 font-mono">
              ✓ Clean ID detected: {extractTweetId(targetTweetId)}
            </div>
          )}
        </div>

        {/* Schedule Mode Selector: Interval vs Fixed Times */}
        <div className="border border-neutral-200 dark:border-neutral-800 rounded-xl p-5 bg-white dark:bg-neutral-900 space-y-5 shadow-xs">
          <div className="flex items-center justify-between border-b border-neutral-200 dark:border-neutral-800 pb-3">
            <span className="text-xs font-bold uppercase tracking-wider text-neutral-700 dark:text-neutral-300 flex items-center gap-2">
              <Clock className="w-4 h-4 text-neutral-500" /> Repeat Timing Mode
            </span>
            <div className="flex items-center gap-1 bg-neutral-100 dark:bg-neutral-800 p-1 rounded-lg text-xs">
              <button
                type="button"
                onClick={() => setIntervalMode('interval')}
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
                onClick={() => setIntervalMode('fixed_times')}
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
                Choose how often ChromaBot automatically drops a new color reply. The internal server timer counts down and triggers a fresh post every time the interval elapses.
              </p>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {INTERVAL_PRESETS.map((preset) => {
                  const isSelected = intervalMinutes === preset.value;
                  return (
                    <button
                      type="button"
                      key={preset.value}
                      onClick={() => setIntervalMinutes(preset.value)}
                      className={`p-3 text-left rounded-xl border transition-all cursor-pointer ${
                        isSelected
                          ? 'border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-950 font-semibold shadow-xs'
                          : 'border-neutral-200 dark:border-neutral-800 hover:border-neutral-300 dark:hover:border-neutral-700 bg-neutral-50 dark:bg-neutral-950/60 text-neutral-800 dark:text-neutral-200'
                      }`}
                    >
                      <div className="text-xs">{preset.label}</div>
                      <div className={`text-[11px] mt-1 font-mono ${isSelected ? 'text-neutral-300 dark:text-neutral-600' : 'text-neutral-400'}`}>
                        {preset.value < 60 ? `${preset.value} min` : `${preset.value / 60} hr${preset.value === 60 ? '' : 's'}`}
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="p-3 bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/40 rounded-lg text-xs text-blue-800 dark:text-blue-300 flex items-center gap-2">
                <Check className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                <span>
                  Active Repeat: <strong>Every {intervalMinutes < 60 ? `${intervalMinutes} minutes` : `${intervalMinutes / 60} hours`}</strong>. The server counts down continuously.
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
                  onChange={(e) => setScheduleTimes(e.target.value)}
                  placeholder="06:00, 18:00"
                  className="w-full px-3.5 py-2 text-sm font-mono border border-neutral-300 dark:border-neutral-700 rounded-lg bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-400 dark:focus:ring-neutral-600"
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
          )}

          {/* Humanized Anti-Bot Timing Jitter (0 to 25% random delay) */}
          <div className="pt-4 border-t border-neutral-200 dark:border-neutral-800 space-y-3">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={humanizeJitterEnabled}
                  onChange={(e) => setHumanizeJitterEnabled(e.target.checked)}
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
              Adds a randomized human-like delay from 0 seconds up to {jitterPercentage}% of each repeat window. This breaks rigid mathematical robotic posting patterns on X and mimics genuine human intervals.
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
                    onChange={(e) => setJitterPercentage(Number(e.target.value))}
                    className="w-full h-1.5 bg-neutral-200 dark:bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-neutral-900 dark:accent-neutral-100"
                  />
                  <span className="text-xs font-mono font-bold w-12 text-right">
                    {jitterPercentage}%
                  </span>
                </div>

                <div className="text-[11px] text-neutral-500 font-mono flex flex-wrap gap-x-4 gap-y-1 pt-1">
                  <span>
                    1m test: <strong>0 - {Math.round(60 * (jitterPercentage / 100))}s delay</strong>
                  </span>
                  <span>
                    15m cycle: <strong>0 - {Math.round((15 * 60) * (jitterPercentage / 100) / 60)}m delay</strong>
                  </span>
                  <span>
                    1h cycle: <strong>0 - {Math.round(60 * (jitterPercentage / 100))}m delay</strong>
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Autonomous Webhook URL & Ping Endpoint */}
        <div className="border border-neutral-200 dark:border-neutral-800 rounded-xl p-5 bg-white dark:bg-neutral-900 space-y-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-neutral-700 dark:text-neutral-300 flex items-center gap-2">
              <Globe className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              Autonomous Webhook Trigger (Zero-Maintenance)
            </span>
            <span className="text-[11px] px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-medium">
              No GitHub Actions Auth Required
            </span>
          </div>

          <p className="text-xs text-neutral-500 leading-relaxed">
            Because this web app already has working X credentials, you can ping this URL from any free recurring cron tool (e.g.{' '}
            <a href="https://cron-job.org" target="_blank" rel="noreferrer" className="text-blue-600 dark:text-blue-400 underline">
              cron-job.org
            </a>{' '}
            or{' '}
            <a href="https://uptimerobot.com" target="_blank" rel="noreferrer" className="text-blue-600 dark:text-blue-400 underline">
              UptimeRobot
            </a>
            ) at your desired frequency. Each ping wakes the app and immediately publishes a live chromatic reply.
          </p>

          <div className="space-y-2">
            <label className="text-[11px] font-semibold text-neutral-600 dark:text-neutral-400 flex items-center gap-1.5">
              <Key className="w-3.5 h-3.5 text-neutral-400" /> Webhook Secret Token (Security)
            </label>
            <input
              type="text"
              value={webhookSecret}
              onChange={(e) => setWebhookSecret(e.target.value)}
              className="w-full px-3 py-1.5 text-xs font-mono border border-neutral-300 dark:border-neutral-700 rounded-lg bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100"
              placeholder="chroma_auto_secret"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-neutral-600 dark:text-neutral-400">
              One-Click Autonomous URL (GET or POST):
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={webhookUrl}
                className="w-full px-3 py-2 text-xs font-mono border border-neutral-200 dark:border-neutral-800 rounded-lg bg-neutral-100 dark:bg-neutral-950 text-neutral-700 dark:text-neutral-300 select-all"
              />
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(webhookUrl);
                  setSavedSuccess(true);
                  setTimeout(() => setSavedSuccess(false), 2000);
                }}
                className="px-3 py-2 text-xs font-semibold bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-neutral-800 dark:text-neutral-200 rounded-lg transition-colors shrink-0 cursor-pointer"
              >
                Copy URL
              </button>
            </div>
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
                When active, the server monitors interval or clock ticks and automatically fires replies.
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
            rows={5}
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
