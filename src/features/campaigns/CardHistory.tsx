/**
 * X ChromaBot - CardHistory
 * Per-campaign post counters on a campaign card, with its "Clear History" action.
 */

import React from 'react';
import { History, Trash2 } from 'lucide-react';
import { TweetContext } from '../../types.js';

interface CardHistoryProps {
  stats: TweetContext['stats'];
  onRequestClearHistory?: () => void;
}

export const CardHistory: React.FC<CardHistoryProps> = ({ stats, onRequestClearHistory }) => (
  <div className="p-2.5 rounded-lg bg-neutral-50 dark:bg-neutral-800/50 border border-neutral-200/70 dark:border-neutral-700/60 flex items-center justify-between gap-2 text-xs">
    <div className="flex items-center gap-2 min-w-0">
      <History className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
      <div className="min-w-0 truncate">
        <span className="font-medium text-neutral-700 dark:text-neutral-300">
          History: {stats?.totalPosts || 0} drops
        </span>
        {stats && stats.totalPosts > 0 && (
          <span className="text-[10px] text-neutral-400 ml-1.5 font-mono">
            ({stats.successfulPosts} sent, {stats.simulatedPosts ?? 0} simulated,{' '}
            {stats.failedPosts} failed)
          </span>
        )}
      </div>
    </div>

    {onRequestClearHistory && (
      <button
        type="button"
        onClick={onRequestClearHistory}
        className="px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100 dark:hover:bg-amber-900/60 rounded border border-amber-200 dark:border-amber-800 transition-colors flex items-center gap-1 cursor-pointer shrink-0"
        title="Clear history and reset stats for this campaign"
      >
        <Trash2 className="w-3 h-3" />
        <span>Clear History</span>
      </button>
    )}
  </div>
);
