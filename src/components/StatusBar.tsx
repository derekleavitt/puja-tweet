import React, { useEffect, useState } from 'react';
import { ExternalLink, Clock, Radio, Power } from 'lucide-react';
import { NextPostInfo, CredentialsStatus } from '../types.js';

interface StatusBarProps {
  nextPost: NextPostInfo | null;
  credentialsStatus: CredentialsStatus | null;
  targetTweetId: string;
  schedulerEnabled: boolean;
  onToggleScheduler: () => void;
  timezone: string;
  scheduleTimes: string[];
}

export const StatusBar: React.FC<StatusBarProps> = ({
  nextPost,
  credentialsStatus,
  targetTweetId,
  schedulerEnabled,
  onToggleScheduler,
  timezone,
  scheduleTimes,
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

  const targetUrl = `https://x.com/pfinallyhere/status/${targetTweetId}`;

  return (
    <div className="bg-neutral-50 dark:bg-neutral-900/60 border-b border-neutral-200 dark:border-neutral-800 px-6 py-2.5 text-xs text-neutral-600 dark:text-neutral-400">
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-y-2 gap-x-6">
        {/* Left: Schedule & Countdown info */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <div className="flex items-center gap-1.5 font-medium text-neutral-900 dark:text-neutral-200">
            <span
              className={`w-2 h-2 rounded-full ${
                schedulerEnabled ? 'bg-emerald-500 animate-pulse' : 'bg-neutral-400'
              }`}
            />
            <span>{schedulerEnabled ? 'Scheduler Active' : 'Scheduler Paused'}</span>
          </div>

          <span aria-hidden="true" className="text-neutral-300 dark:text-neutral-700">·</span>

          <div className="flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-neutral-400" />
            <span>Next Drop:</span>
            <span className="font-mono font-semibold text-neutral-900 dark:text-neutral-100 tabular-nums">
              {formatCountdown(secondsLeft)}
            </span>
            <span className="text-neutral-500">
              ({nextPost ? nextPost.label : `${scheduleTimes.join(' & ')}`})
            </span>
          </div>

          <span aria-hidden="true" className="text-neutral-300 dark:text-neutral-700">·</span>

          <span className="text-neutral-500 font-mono">
            {scheduleTimes.join(' & ')} · {timezone.split('/')[1] || timezone}
          </span>
        </div>

        {/* Right: Target tweet & X Auth status */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <a
            href={targetUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-neutral-700 dark:text-neutral-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors font-mono"
            title="Open target tweet on X"
          >
            <span>Target: #{targetTweetId.substring(0, 7)}…</span>
            <ExternalLink className="w-3 h-3" />
          </a>

          <span aria-hidden="true" className="text-neutral-300 dark:text-neutral-700">·</span>

          <span className="text-neutral-500">
            {credentialsStatus?.isFullyConfigured ? (
              <span className="text-emerald-600 dark:text-emerald-400 font-medium">X API Ready</span>
            ) : (
              <span className="text-amber-600 dark:text-amber-400 font-medium">Keys Needed for Live</span>
            )}
          </span>

          <span aria-hidden="true" className="text-neutral-300 dark:text-neutral-700">·</span>

          <button
            onClick={onToggleScheduler}
            className="hover:text-neutral-900 dark:hover:text-neutral-100 underline underline-offset-2 transition-colors cursor-pointer"
          >
            {schedulerEnabled ? 'Pause' : 'Resume'}
          </button>
        </div>
      </div>
    </div>
  );
};
