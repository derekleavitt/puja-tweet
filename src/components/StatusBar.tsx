/**
 * X ChromaBot - StatusBar
 * Compact all-campaign summary: which campaign posts next (live countdown), why the scheduler is
 * blocked, how many campaigns run, credentials and the global pause. No campaign is "active".
 */

import React, { useEffect, useState } from 'react';
import { Clock, Layers, UserCheck, AlertTriangle } from 'lucide-react';
import { ContextNextPost, CredentialsStatus, TweetContext } from '../types.js';

interface StatusBarProps {
  contexts: TweetContext[];
  nextPosts: ContextNextPost[];
  credentialsStatus: CredentialsStatus | null;
  globalPaused: boolean;
  onToggleGlobalPause: () => void;
}

const SEP = 'text-neutral-300 dark:text-neutral-700 hidden sm:inline';

const formatCountdown = (totalSec: number) => {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${h.toString().padStart(2, '0')}h ${m.toString().padStart(2, '0')}m ${s.toString().padStart(2, '0')}s`;
};

/** The enabled campaign that posts soonest (undefined when every campaign is paused). */
function soonestNextPost(nextPosts: ContextNextPost[]): ContextNextPost | undefined {
  return nextPosts
    .filter((p) => p.enabled)
    .reduce<ContextNextPost | undefined>(
      (best, p) => (!best || p.secondsUntil < best.secondsUntil ? p : best),
      undefined,
    );
}

export const StatusBar: React.FC<StatusBarProps> = ({
  contexts,
  nextPosts,
  credentialsStatus,
  globalPaused,
  onToggleGlobalPause,
}) => {
  const next = soonestNextPost(nextPosts);
  const [secondsLeft, setSecondsLeft] = useState<number>(next?.secondsUntil || 0);

  useEffect(() => {
    setSecondsLeft(next?.secondsUntil ?? 0);
  }, [next?.secondsUntil, next?.contextId]);

  // Local live tick
  useEffect(() => {
    const interval = setInterval(() => {
      setSecondsLeft((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const enabledCount = contexts.filter((c) => c.enabled).length;
  const nextName = next?.contextName || contexts.find((c) => c.id === next?.contextId)?.name;

  return (
    <div className="w-full max-w-full overflow-hidden bg-neutral-50 dark:bg-neutral-900/60 border-b border-neutral-200 dark:border-neutral-800 px-3 sm:px-6 lg:px-8 py-2 text-xs text-neutral-600 dark:text-neutral-400">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-2 w-full min-w-0">
        <div className="flex flex-wrap items-center gap-x-2.5 sm:gap-x-3 gap-y-2">
          <div
            className="flex items-center gap-1.5 font-medium text-neutral-900 dark:text-neutral-200 shrink-0"
            data-testid="status-campaign-count"
          >
            <Layers className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
            <span>
              Scheduled: {enabledCount} of {contexts.length}
            </span>
          </div>

          <span aria-hidden="true" className={SEP}>
            ·
          </span>

          <div className="flex items-center gap-1.5 shrink-0" data-testid="status-next-post">
            <Clock className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
            {next ? (
              <>
                <span>
                  Next:{' '}
                  <strong className="text-neutral-800 dark:text-neutral-200">{nextName}</strong> in
                </span>
                <span className="font-mono font-semibold text-neutral-900 dark:text-neutral-100 tabular-nums">
                  {formatCountdown(secondsLeft)}
                </span>
              </>
            ) : (
              <span>No campaign scheduled</span>
            )}
            {next?.blockedReason && (
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800"
                title="The scheduler will not post until this is resolved."
                data-testid="scheduler-blocked-reason"
              >
                <AlertTriangle className="w-2.5 h-2.5" />
                {next.blockedReason}
              </span>
            )}
            {next?.jitterFormatted && (
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800"
                title={`Humanized random delay of ${next.jitterSeconds}s added to mimic genuine human timing.`}
              >
                <UserCheck className="w-2.5 h-2.5" />
                {next.jitterFormatted}
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-2.5 sm:gap-x-3 gap-y-1.5 pt-1 md:pt-0 border-t md:border-t-0 border-neutral-200/60 dark:border-neutral-800/60">
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
