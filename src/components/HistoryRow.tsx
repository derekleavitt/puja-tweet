/**
 * X ChromaBot - HistoryRow
 * One post log: time, campaign, slot, posted text, status, tweet reference and actions.
 */

import React from 'react';
import { ExternalLink, CheckCircle2, AlertCircle, Radio, Copy, Check } from 'lucide-react';
import { PostLog } from '../types.js';

interface HistoryRowProps {
  log: PostLog;
  copied: boolean;
  onCopy: () => void;
}

export const HistoryRow: React.FC<HistoryRowProps> = ({ log, copied, onCopy }) => {
  const dateStr = new Date(log.timestamp).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  });

  return (
    <tr className="hover:bg-neutral-50/60 dark:hover:bg-neutral-800/30 transition-colors">
      {/* Time & Slot */}
      <td className="py-3.5 px-4 font-mono whitespace-nowrap tabular-nums">
        <div className="text-neutral-900 dark:text-neutral-100 font-medium">{dateStr}</div>
        <div className="text-[11px] text-neutral-400 flex items-center gap-1.5 flex-wrap">
          {log.contextName && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800/60">
              {log.contextName}
            </span>
          )}
          <span>
            {log.slotType === 'morning'
              ? 'Morning Drop'
              : log.slotType === 'evening'
                ? 'Evening Drop'
                : 'Manual Drop'}
          </span>
        </div>
      </td>

      {/* Tweet text */}
      <td className="py-3.5 px-4 min-w-48 max-w-sm">
        <p
          data-testid="history-tweet-text"
          className="text-neutral-800 dark:text-neutral-200 leading-snug line-clamp-2 break-words"
          title={log.tweetText}
        >
          {log.tweetText}
        </p>
      </td>

      {/* Status */}
      <td className="py-3.5 px-4 whitespace-nowrap">
        {log.status === 'success' ? (
          <div className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-medium">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Posted to X</span>
          </div>
        ) : log.status === 'simulated' ? (
          <div className="inline-flex items-center gap-1.5 text-amber-600 dark:text-amber-400 font-medium">
            <Radio className="w-3.5 h-3.5" />
            <span>Simulated</span>
          </div>
        ) : (
          <div className="inline-flex items-center gap-1.5 text-red-600 dark:text-red-400 font-medium">
            <AlertCircle className="w-3.5 h-3.5" />
            <span>Failed</span>
          </div>
        )}
        {log.errorMessage && (
          <div
            className="text-[10px] text-red-500 font-mono mt-0.5 max-w-xs truncate"
            title={log.errorMessage}
          >
            {log.errorMessage}
          </div>
        )}
      </td>

      {/* Tweet Reference */}
      <td className="py-3.5 px-4 font-mono text-[11px] text-neutral-500">
        {log.tweetId ? (
          <div className="font-semibold text-neutral-800 dark:text-neutral-200">
            ID: {log.tweetId}
          </div>
        ) : (
          <div>Target: #{log.targetTweetId}</div>
        )}
        <div className="text-[10px] text-neutral-400 mt-0.5 flex items-center gap-1 flex-wrap">
          {log.quoteTweetId || log.engagementMode === 'quote' ? (
            <>
              <span>Quote #{log.quoteTweetId || log.targetTweetId}</span>
              <span className="text-[9px] font-semibold px-1 py-0.2 rounded bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 font-sans">
                Quote Tweet
              </span>
            </>
          ) : (
            <>
              <span>Reply to #{log.replyToTweetId || log.targetTweetId}</span>
              {log.replyToTweetId && log.replyToTweetId !== log.targetTweetId ? (
                <span className="text-[9px] font-semibold px-1 py-0.2 rounded bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 font-sans">
                  Chain
                </span>
              ) : (
                <span className="text-[9px] font-semibold px-1 py-0.2 rounded bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 font-sans">
                  Root
                </span>
              )}
            </>
          )}
        </div>
      </td>

      {/* Actions */}
      <td className="py-3.5 px-4 whitespace-nowrap">
        <div className="flex items-center gap-2">
          {log.tweetUrl && (
            <a
              href={log.tweetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-2 py-1 bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-neutral-800 dark:text-neutral-200 rounded text-xs font-medium inline-flex items-center gap-1 transition-colors"
            >
              <span>View</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
          <button
            onClick={onCopy}
            className="p-1 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 transition-colors cursor-pointer"
            title="Copy full tweet payload"
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-emerald-600" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </td>
    </tr>
  );
};
