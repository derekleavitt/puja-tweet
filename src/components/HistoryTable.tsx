import React, { useState } from 'react';
import { ExternalLink, CheckCircle2, AlertCircle, Radio, Trash2, Copy, Check } from 'lucide-react';
import { PostLog } from '../types.js';

interface HistoryTableProps {
  logs: PostLog[];
  onClearHistory: () => void;
}

export const HistoryTable: React.FC<HistoryTableProps> = ({ logs, onClearHistory }) => {
  const [filter, setFilter] = useState<'all' | 'success' | 'simulated' | 'error'>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const filteredLogs = logs.filter((log) => {
    if (filter === 'all') return true;
    return log.status === filter;
  });

  const copyText = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-neutral-200 dark:border-neutral-800">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
            Post Logs & History
          </h2>
          <p className="text-sm text-neutral-500 mt-0.5">
            Audit trail of all automated 6am/6pm drops and manual test replies sent to X.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Segmented Filter Control */}
          <div className="flex items-center gap-1 p-1 bg-neutral-100 dark:bg-neutral-900 rounded-lg text-xs">
            {(['all', 'success', 'simulated', 'error'] as const).map((key) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={`px-2.5 py-1 font-medium rounded-md capitalize transition-colors cursor-pointer ${
                  filter === key
                    ? 'bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 shadow-xs'
                    : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200'
                }`}
              >
                {key}
              </button>
            ))}
          </div>

          {logs.length > 0 && (
            <button
              onClick={onClearHistory}
              className="p-1.5 text-neutral-400 hover:text-red-500 rounded-md transition-colors cursor-pointer"
              title="Clear all logs"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {filteredLogs.length === 0 ? (
        <div className="border border-neutral-200 dark:border-neutral-800 rounded-xl p-12 text-center text-neutral-500 bg-white dark:bg-neutral-900">
          <p className="font-medium text-neutral-700 dark:text-neutral-300">No post logs recorded yet</p>
          <p className="text-xs text-neutral-400 mt-1">
            Trigger a test post in the Studio or wait for the next scheduled 6:00 AM / 6:00 PM drop.
          </p>
        </div>
      ) : (
        <div className="border border-neutral-200 dark:border-neutral-800 rounded-xl overflow-hidden bg-white dark:bg-neutral-900 shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-neutral-50 dark:bg-neutral-950/60 border-b border-neutral-200 dark:border-neutral-800 text-neutral-500 uppercase tracking-wider font-semibold text-[10px]">
                <tr>
                  <th className="py-3 px-4">Time & Slot</th>
                  <th className="py-3 px-4">Color Swatch</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Tweet Reference</th>
                  <th className="py-3 px-4">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800/80">
                {filteredLogs.map((log) => {
                  const dateStr = new Date(log.timestamp).toLocaleString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  });

                  return (
                    <tr
                      key={log.id}
                      className="hover:bg-neutral-50/60 dark:hover:bg-neutral-800/30 transition-colors"
                    >
                      {/* Time & Slot */}
                      <td className="py-3.5 px-4 font-mono whitespace-nowrap tabular-nums">
                        <div className="text-neutral-900 dark:text-neutral-100 font-medium">
                          {dateStr}
                        </div>
                        <div className="text-[11px] text-neutral-400">
                          {log.slotType === 'morning'
                            ? '6:00 AM Morning Drop'
                            : log.slotType === 'evening'
                            ? '6:00 PM Evening Drop'
                            : 'Manual Test Drop'}
                        </div>
                      </td>

                      {/* Color Swatch */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="flex items-center gap-2.5">
                          <span
                            className="w-5 h-5 rounded-md border border-neutral-200 dark:border-neutral-700 shadow-2xs shrink-0"
                            style={{ backgroundColor: log.color?.hex || '#000000' }}
                          />
                          <div>
                            <div className="font-semibold text-neutral-900 dark:text-neutral-100">
                              {log.color?.name || 'Color'}
                            </div>
                            <div className="font-mono text-[11px] text-neutral-400 tabular-nums">
                              {log.color?.hex}
                            </div>
                          </div>
                        </div>
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
                          <div className="text-[10px] text-red-500 font-mono mt-0.5 max-w-xs truncate" title={log.errorMessage}>
                            {log.errorMessage}
                          </div>
                        )}
                      </td>

                      {/* Tweet Reference */}
                      <td className="py-3.5 px-4 font-mono text-[11px] text-neutral-500">
                        {log.tweetId ? (
                          <span className="text-neutral-700 dark:text-neutral-300">
                            ID: {log.tweetId}
                          </span>
                        ) : (
                          <span>Target: #{log.targetTweetId}</span>
                        )}
                        <div className="text-[10px] text-neutral-400">
                          Reply to #{log.targetTweetId}
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
                            onClick={() => copyText(log.tweetText, log.id)}
                            className="p-1 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 transition-colors cursor-pointer"
                            title="Copy full tweet payload"
                          >
                            {copiedId === log.id ? (
                              <Check className="w-3.5 h-3.5 text-emerald-600" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
