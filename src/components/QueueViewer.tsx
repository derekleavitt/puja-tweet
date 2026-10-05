/**
 * X ChromaBot - QueueViewer
 * Upcoming posts of one campaign (picked here, a filter only): when each goes out and its text.
 */

import React, { useState } from 'react';
import { RefreshCw, Layers, MessageSquare, Clock, Target, Sparkles } from 'lucide-react';
import { QueueSlot, TweetContext } from '../types.js';
import { formatHHmm12h, tzAbbreviation } from '../../shared/time.js';
import { templateUsesColor } from '../lib/templateTokens.js';
import { QueueSlotCard } from './QueueSlotCard.js';

interface QueueViewerProps {
  queue: QueueSlot[];
  onRerollSlot: (slotId: string) => void;
  onPostNow: (slot: QueueSlot) => void;
  isPosting: boolean;
  contexts?: TweetContext[];
  /** The campaign whose queue is shown. */
  contextId: string;
  onPickContext: (id: string) => void;
  onRegenerateQueue?: () => Promise<void>;
}

export const QueueViewer: React.FC<QueueViewerProps> = ({
  queue,
  onRerollSlot,
  onPostNow,
  isPosting,
  contexts = [],
  contextId,
  onPickContext,
  onRegenerateQueue,
}) => {
  const [isRegenerating, setIsRegenerating] = useState(false);

  const activeContext = contexts.find((c) => c.id === contextId);

  const slotContext = (slot: QueueSlot) =>
    contexts.find((c) => c.id === slot.contextId) || activeContext;

  const handleRegenerate = async () => {
    if (!onRegenerateQueue) return;
    setIsRegenerating(true);
    try {
      await onRegenerateQueue();
    } finally {
      setIsRegenerating(false);
    }
  };

  const cadenceLabel = activeContext
    ? activeContext.schedule?.mode === 'interval'
      ? `Every ${activeContext.schedule.intervalMinutes}m`
      : `Daily at ${(activeContext.schedule?.scheduleTimes || ['06:00', '18:00']).map(formatHHmm12h).join(', ')} (${tzAbbreviation(new Date(), activeContext.schedule?.timezone)})`
    : 'Twice Daily Cadence';

  const conversation = activeContext?.mode === 'conversation';
  const voices = activeContext?.conversation?.participants.length ?? 0;
  const modeLabel = activeContext
    ? activeContext.engagementMode === 'quote'
      ? 'Quote Tweet'
      : activeContext.engagementMode === 'standalone'
        ? 'Timeline Drop'
        : activeContext.replyTargetMode === 'last_comment'
          ? 'Cascading Chain Reply'
          : 'Direct Reply (Root)'
    : 'Direct Reply';

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-neutral-200 dark:border-neutral-800">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h2 className="text-xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
              Scheduled Drop Queue (14 Slots)
            </h2>
            {contexts.length > 0 && (
              <div className="flex items-center gap-1.5 bg-neutral-100 dark:bg-neutral-800 px-2.5 py-1 rounded-lg border border-neutral-200 dark:border-neutral-700 text-xs">
                <Layers className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                <span className="font-semibold text-neutral-500">Campaign:</span>
                <select
                  aria-label="Queue campaign"
                  value={contextId}
                  onChange={(e) => onPickContext(e.target.value)}
                  className="bg-transparent font-medium text-neutral-900 dark:text-neutral-100 focus:outline-none cursor-pointer pr-1 text-xs"
                >
                  {contexts.map((c) => (
                    <option
                      key={c.id}
                      value={c.id}
                      className="bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100"
                    >
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <p className="text-sm text-neutral-500 mt-1">
            Any save or edit to a campaign automatically clears and regenerates its 14 upcoming
            slots using the updated template &amp; schedule.
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="text-xs text-neutral-500 font-mono">
            <span>{queue.length} Slots Buffered</span>
            <span className="mx-2">·</span>
            <span>{cadenceLabel}</span>
          </div>

          {onRegenerateQueue && (
            <button
              type="button"
              onClick={handleRegenerate}
              disabled={isRegenerating}
              className="px-3 py-1.5 text-xs font-semibold text-indigo-700 dark:text-indigo-300 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/60 dark:hover:bg-indigo-900/60 border border-indigo-200 dark:border-indigo-800 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              title="Clear all 14 slots for this campaign and regenerate fresh template previews"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRegenerating ? 'animate-spin' : ''}`} />
              <span>Clear &amp; Regenerate Queue</span>
            </button>
          )}
        </div>
      </div>

      {/* Shown campaign: template & schedule banner */}
      {activeContext && conversation && (
        <div
          data-testid="queue-conversation-banner"
          className="p-4 rounded-xl bg-indigo-50/60 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-900 shadow-2xs flex flex-wrap items-center gap-3 text-xs"
        >
          <span className="font-semibold text-indigo-700 dark:text-indigo-300">
            Conversation ({voices} voices)
          </span>
          <span className="text-neutral-300 dark:text-neutral-700">·</span>
          <span className="flex items-center gap-1.5 font-semibold text-neutral-900 dark:text-neutral-100">
            <Target className="w-3.5 h-3.5 text-indigo-500" />
            Opening reply:
            <span className="font-mono text-indigo-600 dark:text-indigo-400">
              #{activeContext.targetTweetId}
            </span>
          </span>
          <span className="text-neutral-300 dark:text-neutral-700">·</span>
          <span className="text-neutral-600 dark:text-neutral-400">
            Schedule:{' '}
            <strong className="text-neutral-800 dark:text-neutral-200 font-mono">
              {cadenceLabel}
            </strong>
          </span>
        </div>
      )}
      {activeContext && !conversation && (
        <div className="p-4 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-2xs flex flex-col lg:flex-row lg:items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5 font-semibold text-neutral-900 dark:text-neutral-100">
              <Target className="w-3.5 h-3.5 text-indigo-500" />
              <span>Target:</span>
              <span className="font-mono text-indigo-600 dark:text-indigo-400">
                #{activeContext.targetTweetId}
              </span>
            </div>
            <span className="text-neutral-300 dark:text-neutral-700">·</span>
            <div className="flex items-center gap-1.5 text-neutral-600 dark:text-neutral-400">
              <MessageSquare className="w-3.5 h-3.5 text-blue-500" />
              <span>
                Mode:{' '}
                <strong className="text-neutral-800 dark:text-neutral-200">{modeLabel}</strong>
              </span>
            </div>
            <span className="text-neutral-300 dark:text-neutral-700">·</span>
            <div className="flex items-center gap-1.5 text-neutral-600 dark:text-neutral-400">
              <Clock className="w-3.5 h-3.5 text-emerald-500" />
              <span>
                Schedule:{' '}
                <strong className="text-neutral-800 dark:text-neutral-200 font-mono">
                  {cadenceLabel}
                </strong>
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 min-w-0 bg-neutral-50 dark:bg-neutral-800/70 px-3 py-1.5 rounded-lg border border-neutral-200/70 dark:border-neutral-700/70">
            <Sparkles className="w-3.5 h-3.5 text-purple-500 shrink-0" />
            <span className="text-neutral-500 shrink-0">Template:</span>
            <span
              className="font-mono text-neutral-800 dark:text-neutral-200 truncate max-w-md"
              title={activeContext.template}
            >
              {activeContext.template}
            </span>
          </div>
        </div>
      )}

      {/* Upcoming posts */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {queue.map((slot, idx) => (
          <QueueSlotCard
            key={slot.slotId}
            slot={slot}
            index={idx}
            timezone={slotContext(slot)?.schedule?.timezone}
            canReroll={
              slotContext(slot)?.mode !== 'conversation' &&
              templateUsesColor(slotContext(slot)?.template)
            }
            conversation={slotContext(slot)?.mode === 'conversation'}
            isNextTurn={idx === 0}
            evolvesHashtags={!!slotContext(slot)?.hashtagEvolution?.enabled}
            lastHashtags={slotContext(slot)?.hashtagState?.current}
            isPosting={isPosting}
            onReroll={() => onRerollSlot(slot.slotId)}
            onSend={() => onPostNow(slot)}
          />
        ))}
      </div>
    </div>
  );
};
