import React, { useEffect, useState } from 'react';
import { ExternalLink, Clock, Repeat, UserCheck } from 'lucide-react';
import { NextPostInfo, CredentialsStatus, BotSettings, TweetContext } from '../types.js';

interface StatusBarProps {
  nextPost: NextPostInfo | null;
  credentialsStatus: CredentialsStatus | null;
  targetTweetId: string;
  globalPaused: boolean;
  onToggleGlobalPause: () => void;
  settings?: BotSettings;
  activeContext?: TweetContext;
  onChangeFrequency?: (mode: 'interval' | 'fixed_times', minutes?: number) => void;
}

const FREQUENCY_OPTIONS = [
  { label: 'Every 1 minute (Test)', mode: 'interval' as const, minutes: 1 },
  { label: 'Every 15 minutes', mode: 'interval' as const, minutes: 15 },
  { label: 'Every 30 minutes', mode: 'interval' as const, minutes: 30 },
  { label: 'Every 1 hour', mode: 'interval' as const, minutes: 60 },
  { label: 'Every 3 hours', mode: 'interval' as const, minutes: 180 },
  { label: 'Every 6 hours', mode: 'interval' as const, minutes: 360 },
  { label: 'Every 12 hours', mode: 'interval' as const, minutes: 720 },
  { label: 'Every 24 hours', mode: 'interval' as const, minutes: 1440 },
  { label: 'Daily at 6:00 AM & 6:00 PM', mode: 'fixed_times' as const, minutes: 720 },
];

export const StatusBar: React.FC<StatusBarProps> = ({
  nextPost,
  credentialsStatus,
  targetTweetId,
  globalPaused,
  onToggleGlobalPause,
  settings,
  activeContext,
  onChangeFrequency,
}) => {
  const [secondsLeft, setSecondsLeft] = useState<number>(nextPost?.secondsUntil || 0);

  useEffect(() => {
    if (nextPost?.secondsUntil !== undefined) {
      setSecondsLeft(nextPost.secondsUntil);
    }
  }, [nextPost?.secondsUntil]);

  // Local live tick
  useEffect(() => {
    const interval = setInterval(() => {
      setSecondsLeft((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const formatCountdown = (totalSec: number) => {
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return `${h.toString().padStart(2, '0')}h ${m.toString().padStart(2, '0')}m ${s.toString().padStart(2, '0')}s`;
  };

  const effectiveTargetId = activeContext?.targetTweetId || targetTweetId;
  const targetUrl = `https://x.com/i/status/${effectiveTargetId}`;
  const isInterval = (activeContext?.schedule?.mode || settings?.intervalMode) === 'interval';
  const intervalMins = activeContext?.schedule?.intervalMinutes || settings?.intervalMinutes || 720;

  // Selected value for select dropdown
  const currentValue = isInterval ? `interval_${intervalMins}` : 'fixed_720';

  const handleSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    if (!onChangeFrequency) return;
    if (val === 'fixed_720') {
      onChangeFrequency('fixed_times');
    } else if (val.startsWith('interval_')) {
      const mins = parseInt(val.replace('interval_', ''), 10);
      onChangeFrequency('interval', mins);
    }
  };

  return (
    <div className="w-full max-w-full overflow-hidden bg-neutral-50 dark:bg-neutral-900/60 border-b border-neutral-200 dark:border-neutral-800 px-3 sm:px-6 lg:px-8 py-2 text-xs text-neutral-600 dark:text-neutral-400">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-2 w-full min-w-0">
        {/* Left: Active Context, Schedule & Frequency Dropdown & Countdown info */}
        <div className="flex flex-wrap items-center gap-x-2.5 sm:gap-x-3 gap-y-2">
          {activeContext && (
            <div className="flex items-center gap-1.5 font-medium text-neutral-900 dark:text-neutral-200 shrink-0">
              <span
                className={`w-2 h-2 rounded-full ${
                  activeContext.enabled ? 'bg-indigo-500 animate-pulse' : 'bg-neutral-400'
                }`}
              />
              <span className="font-semibold truncate max-w-[140px] sm:max-w-[180px]">
                {activeContext.name}
              </span>
              <span className="text-[11px] text-neutral-400">
                ({activeContext.enabled ? 'Active' : 'Paused'})
              </span>
            </div>
          )}

          <span
            aria-hidden="true"
            className="text-neutral-300 dark:text-neutral-700 hidden sm:inline"
          >
            ·
          </span>

          {/* Quick Frequency Dropdown */}
          <div className="flex items-center gap-1.5 bg-white dark:bg-neutral-800 px-2 py-1 rounded-md border border-neutral-200 dark:border-neutral-700 shadow-2xs shrink-0">
            <Repeat className="w-3.5 h-3.5 text-neutral-500 dark:text-neutral-400 shrink-0" />
            <span className="font-semibold text-neutral-700 dark:text-neutral-300 hidden sm:inline">
              Freq:
            </span>
            <select
              value={currentValue}
              onChange={handleSelectChange}
              className="bg-transparent font-medium text-neutral-900 dark:text-neutral-100 focus:outline-none cursor-pointer pr-1 text-xs"
            >
              {FREQUENCY_OPTIONS.map((opt) => {
                const key = opt.mode === 'interval' ? `interval_${opt.minutes}` : 'fixed_720';
                return (
                  <option
                    key={key}
                    value={key}
                    className="bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100"
                  >
                    {opt.label}
                  </option>
                );
              })}
            </select>
          </div>

          <span
            aria-hidden="true"
            className="text-neutral-300 dark:text-neutral-700 hidden sm:inline"
          >
            ·
          </span>

          <div className="flex items-center gap-1.5 shrink-0">
            <Clock className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
            <span className="hidden sm:inline">Next:</span>
            <span className="font-mono font-semibold text-neutral-900 dark:text-neutral-100 tabular-nums">
              {formatCountdown(secondsLeft)}
            </span>
            {nextPost?.jitterFormatted && (
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800"
                title={`Humanized random delay of ${nextPost.jitterSeconds}s added to mimic genuine human timing.`}
              >
                <UserCheck className="w-2.5 h-2.5" />
                {nextPost.jitterFormatted}
              </span>
            )}
          </div>
        </div>

        {/* Right: Target tweet & X Auth status */}
        <div className="flex flex-wrap items-center gap-x-2.5 sm:gap-x-3 gap-y-1.5 pt-1 md:pt-0 border-t md:border-t-0 border-neutral-200/60 dark:border-neutral-800/60">
          <a
            href={targetUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-neutral-700 dark:text-neutral-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors font-mono shrink-0"
            title="Open target tweet on X"
          >
            <span>Target: #{effectiveTargetId.substring(0, 7)}…</span>
            <ExternalLink className="w-3 h-3" />
          </a>

          <span aria-hidden="true" className="text-neutral-300 dark:text-neutral-700">
            ·
          </span>

          <span className="text-neutral-500 shrink-0">
            {credentialsStatus?.isFullyConfigured ? (
              <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                X API Ready
              </span>
            ) : (
              <span className="text-amber-600 dark:text-amber-400 font-medium">Keys Needed</span>
            )}
          </span>

          <span aria-hidden="true" className="text-neutral-300 dark:text-neutral-700">
            ·
          </span>

          <button
            onClick={onToggleGlobalPause}
            title="Global pause: stops or resumes scheduled drops for ALL campaigns"
            className="hover:text-neutral-900 dark:hover:text-neutral-100 underline underline-offset-2 transition-colors cursor-pointer shrink-0"
          >
            {globalPaused ? 'Resume all' : 'Pause all'}
          </button>
        </div>
      </div>
    </div>
  );
};
