/**
 * X ChromaBot - WipeProgress
 * The "delete all content" line under an X account: what was removed so far, what it waits for,
 * and Cancel while it runs.
 */

import React from 'react';
import { Eraser } from 'lucide-react';
import { WipeJobSummary } from '../../types.js';

interface WipeProgressProps {
  wipe: WipeJobSummary;
  busy: boolean;
  onCancel: () => void;
}

const STATUS: Record<WipeJobSummary['status'], string> = {
  running: 'Deleting',
  done: 'Done',
  cancelled: 'Cancelled',
  failed: 'Stopped',
};

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

export const WipeProgress: React.FC<WipeProgressProps> = ({ wipe, busy, onCancel }) => {
  const { posts, retweets, likes, failed } = wipe.counts;
  const verb = wipe.simulate ? 'found' : 'removed';
  const status = wipe.simulate && wipe.status === 'running' ? 'Counting' : STATUS[wipe.status];
  const doing =
    wipe.status !== 'running'
      ? ''
      : wipe.waitingUntil
        ? ` · waiting for X's rate limit until ${time(wipe.waitingUntil)}`
        : ` · ${wipe.phase === 'posts' ? 'posts' : 'likes'}, pass ${wipe.pass}${wipe.queued ? `, ${wipe.queued} queued` : ''}`;

  return (
    <div
      data-testid="wipe-progress"
      className={`mt-1 flex items-center gap-1.5 flex-wrap text-[11px] ${
        wipe.status === 'failed'
          ? 'text-red-600 dark:text-red-400'
          : 'text-neutral-600 dark:text-neutral-400'
      }`}
    >
      <Eraser className="w-3 h-3 shrink-0" />
      <span className="font-semibold">
        {status}
        {wipe.simulate ? ' (dry run)' : ''}:
      </span>
      <span>
        {posts} posts, {retweets} retweets, {likes} likes {verb}
        {failed ? `, ${failed} failed` : ''}
        {doing}
      </span>
      {wipe.lastError && wipe.status !== 'done' && (
        <span title={wipe.lastError}>· {wipe.lastError}</span>
      )}
      {wipe.status === 'running' && (
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="ml-1 underline text-red-600 dark:text-red-400 cursor-pointer disabled:opacity-50"
        >
          Cancel
        </button>
      )}
    </div>
  );
};
