/**
 * X ChromaBot - HistoryTable
 * Post logs of every campaign, filterable by campaign and by status.
 */

import React, { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { PostLog, TweetContext } from '../types.js';
import { HistoryRow } from './HistoryRow.js';

/** Logs written before campaigns were tagged belong to the primary campaign. */
const logCampaignId = (log: PostLog) => log.contextId || 'ctx_primary';

interface HistoryTableProps {
  logs: PostLog[];
  contexts?: TweetContext[];
  onClearHistory: () => void;
}

export const HistoryTable: React.FC<HistoryTableProps> = ({
  logs,
  contexts = [],
  onClearHistory,
}) => {
  const [filter, setFilter] = useState<'all' | 'success' | 'simulated' | 'error'>('all');
  const [campaign, setCampaign] = useState<string>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const filteredLogs = logs.filter(
    (log) =>
      (filter === 'all' || log.status === filter) &&
      (campaign === 'all' || logCampaignId(log) === campaign),
  );

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
            Audit trail of all automated scheduled drops and manual test replies sent to X.
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {contexts.length > 1 && (
            <select
              aria-label="Filter by campaign"
              value={campaign}
              onChange={(e) => setCampaign(e.target.value)}
              className="px-2 py-1.5 text-xs font-medium rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-neutral-800 dark:text-neutral-200 cursor-pointer"
            >
              <option value="all">All campaigns</option>
              {contexts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
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
          <p className="font-medium text-neutral-700 dark:text-neutral-300">
            No post logs recorded yet
          </p>
          <p className="text-xs text-neutral-400 mt-1">
            Use “Preview & post” on a campaign card or wait for the next scheduled drop.
          </p>
        </div>
      ) : (
        <div className="border border-neutral-200 dark:border-neutral-800 rounded-xl overflow-hidden bg-white dark:bg-neutral-900 shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-neutral-50 dark:bg-neutral-950/60 border-b border-neutral-200 dark:border-neutral-800 text-neutral-500 uppercase tracking-wider font-semibold text-[10px]">
                <tr>
                  <th className="py-3 px-4">Time & Slot</th>
                  <th className="py-3 px-4">Tweet</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Tweet Reference</th>
                  <th className="py-3 px-4">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800/80">
                {filteredLogs.map((log) => (
                  <HistoryRow
                    key={log.id}
                    log={log}
                    copied={copiedId === log.id}
                    onCopy={() => copyText(log.tweetText, log.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
