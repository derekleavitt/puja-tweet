/**
 * X ChromaBot - QueueSlotCard
 * One upcoming post: when it goes out, the text it will post, and its actions.
 */

import React from 'react';
import { Sun, Moon, RefreshCw, Send } from 'lucide-react';
import { QueueSlot } from '../types.js';
import { formatHHmm12h, tzAbbreviation } from '../../shared/time.js';

interface QueueSlotCardProps {
  slot: QueueSlot;
  index: number;
  timezone?: string;
  /** The slot's campaign template uses a color token, so re-rolling changes its text. */
  canReroll: boolean;
  isPosting: boolean;
  onReroll: () => void;
  onSend: () => void;
}

export const QueueSlotCard: React.FC<QueueSlotCardProps> = ({
  slot,
  index,
  timezone,
  canReroll,
  isPosting,
  onReroll,
  onSend,
}) => {
  const dayName = new Date(slot.dateStr + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  const SlotIcon = slot.slotType === 'morning' ? Sun : Moon;

  return (
    <div
      data-testid="queue-slot"
      className="border border-neutral-200 dark:border-neutral-800 rounded-xl bg-white dark:bg-neutral-900 flex flex-col justify-between hover:border-neutral-300 dark:hover:border-neutral-700 transition-all shadow-xs p-3.5 space-y-3 text-xs"
    >
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2 text-[11px]">
          <span className="flex items-center gap-1.5 font-medium text-neutral-700 dark:text-neutral-300">
            <SlotIcon className="w-3.5 h-3.5 text-neutral-400" />
            <span>
              #{index + 1} · {dayName}
            </span>
          </span>
          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300">
            {formatHHmm12h(slot.timeSlot)} {tzAbbreviation(new Date(), timezone)}
          </span>
        </div>

        <div className="p-2 rounded-lg bg-neutral-50 dark:bg-neutral-800/70 border border-neutral-200/70 dark:border-neutral-700/60">
          <div className="text-[10px] uppercase font-mono text-neutral-400 mb-0.5 flex items-center justify-between">
            <span>Queued Message</span>
            {slot.targetTweetId && <span>→ #{slot.targetTweetId.slice(0, 6)}…</span>}
          </div>
          {slot.previewText ? (
            <p
              className="text-neutral-800 dark:text-neutral-200 text-[11px] font-mono leading-snug line-clamp-4 break-words"
              title={slot.previewText}
            >
              {slot.previewText}
            </p>
          ) : (
            <p className="text-neutral-400 text-[11px] italic">Text is composed when it posts.</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 pt-2 border-t border-neutral-100 dark:border-neutral-800">
        {canReroll && (
          <button
            onClick={onReroll}
            className="flex-1 py-1.5 px-2 text-xs font-medium text-neutral-700 dark:text-neutral-300 bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 rounded-md transition-colors flex items-center justify-center gap-1 cursor-pointer"
            title="Re-roll the color token for this slot's message"
          >
            <RefreshCw className="w-3 h-3" />
            Re-roll
          </button>
        )}

        <button
          onClick={onSend}
          disabled={isPosting}
          className={`py-1.5 px-2.5 text-xs font-medium text-white bg-neutral-900 hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200 rounded-md transition-colors flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50 ${canReroll ? '' : 'flex-1'}`}
          title="Send this post now"
        >
          <Send className="w-3 h-3" />
          <span>Send</span>
        </button>
      </div>
    </div>
  );
};
