import React, { useState } from 'react';
import { Sun, Moon, RefreshCw, Send, Layers, MessageSquare, Clock, Target, Sparkles } from 'lucide-react';
import { QueueSlot, ColorData, TweetContext } from '../types.js';

interface QueueViewerProps {
  queue: QueueSlot[];
  onRerollSlot: (slotId: string) => void;
  onPostNow: (color: ColorData, slotType: 'morning' | 'evening' | 'manual') => void;
  isPosting: boolean;
  contexts?: TweetContext[];
  activeContextId?: string;
  onSelectContext?: (id: string) => Promise<void>;
  onRegenerateQueue?: (contextId?: string) => Promise<void>;
}

export const QueueViewer: React.FC<QueueViewerProps> = ({
  queue,
  onRerollSlot,
  onPostNow,
  isPosting,
  contexts = [],
  activeContextId = '',
  onSelectContext,
  onRegenerateQueue,
}) => {
  const [isRegenerating, setIsRegenerating] = useState(false);

  const activeContext = contexts.find(c => c.id === activeContextId) || contexts[0];

  const handleRegenerate = async () => {
    if (!onRegenerateQueue) return;
    setIsRegenerating(true);
    try {
      await onRegenerateQueue(activeContext?.id);
    } finally {
      setIsRegenerating(false);
    }
  };

  const cadenceLabel = activeContext
    ? activeContext.schedule?.mode === 'interval'
      ? `Every ${activeContext.schedule.intervalMinutes}m`
      : `Daily at ${(activeContext.schedule?.scheduleTimes || ['06:00', '18:00']).join(', ')} (${activeContext.schedule?.timezone || 'America/Denver'})`
    : 'Twice Daily Cadence';

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
            {contexts.length > 0 && onSelectContext && (
              <div className="flex items-center gap-1.5 bg-neutral-100 dark:bg-neutral-800 px-2.5 py-1 rounded-lg border border-neutral-200 dark:border-neutral-700 text-xs">
                <Layers className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                <span className="font-semibold text-neutral-500">Campaign:</span>
                <select
                  value={activeContext?.id || activeContextId}
                  onChange={(e) => onSelectContext(e.target.value)}
                  className="bg-transparent font-medium text-neutral-900 dark:text-neutral-100 focus:outline-none cursor-pointer pr-1 text-xs"
                >
                  {contexts.map((c) => (
                    <option key={c.id} value={c.id} className="bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100">
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <p className="text-sm text-neutral-500 mt-1">
            Any save or edit to a campaign automatically clears and regenerates its 14 upcoming slots using the updated template &amp; schedule.
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
              title="Clear all 14 slots for this campaign and regenerate fresh colors & template previews"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRegenerating ? 'animate-spin' : ''}`} />
              <span>Clear &amp; Regenerate Queue</span>
            </button>
          )}
        </div>
      </div>

      {/* Active Campaign Template & Schedule Context Banner */}
      {activeContext && (
        <div className="p-4 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-2xs flex flex-col lg:flex-row lg:items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5 font-semibold text-neutral-900 dark:text-neutral-100">
              <Target className="w-3.5 h-3.5 text-indigo-500" />
              <span>Target:</span>
              <span className="font-mono text-indigo-600 dark:text-indigo-400">#{activeContext.targetTweetId}</span>
            </div>
            <span className="text-neutral-300 dark:text-neutral-700">·</span>
            <div className="flex items-center gap-1.5 text-neutral-600 dark:text-neutral-400">
              <MessageSquare className="w-3.5 h-3.5 text-blue-500" />
              <span>Mode: <strong className="text-neutral-800 dark:text-neutral-200">{modeLabel}</strong></span>
            </div>
            <span className="text-neutral-300 dark:text-neutral-700">·</span>
            <div className="flex items-center gap-1.5 text-neutral-600 dark:text-neutral-400">
              <Clock className="w-3.5 h-3.5 text-emerald-500" />
              <span>Schedule: <strong className="text-neutral-800 dark:text-neutral-200 font-mono">{cadenceLabel}</strong></span>
            </div>
          </div>

          <div className="flex items-center gap-2 min-w-0 bg-neutral-50 dark:bg-neutral-800/70 px-3 py-1.5 rounded-lg border border-neutral-200/70 dark:border-neutral-700/70">
            <Sparkles className="w-3.5 h-3.5 text-purple-500 shrink-0" />
            <span className="text-neutral-500 shrink-0">Active Template:</span>
            <span className="font-mono text-neutral-800 dark:text-neutral-200 truncate max-w-md" title={activeContext.template}>
              {activeContext.template}
            </span>
          </div>
        </div>
      )}

      {/* Grid of queue slots */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {queue.map((slot, idx) => {
          const isMorning = slot.slotType === 'morning';
          const dateObj = new Date(slot.dateStr + 'T12:00:00');
          const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
          const previewMessage = slot.previewText || `${slot.color.colorPick || slot.color.name} ${slot.color.weatherDesc || slot.color.mood} #eternal #colors`;

          return (
            <div
              key={slot.slotId}
              className="border border-neutral-200 dark:border-neutral-800 rounded-xl overflow-hidden bg-white dark:bg-neutral-900 flex flex-col justify-between hover:border-neutral-300 dark:hover:border-neutral-700 transition-all shadow-xs"
            >
              {/* Swatch Header */}
              <div
                className="h-28 p-3 flex flex-col justify-between transition-colors relative"
                style={{ backgroundColor: slot.color.hex }}
              >
                <div className="flex items-center justify-between">
                  <span
                    className="px-2 py-0.5 text-[11px] font-medium rounded-md shadow-xs backdrop-blur-md flex items-center gap-1 font-mono"
                    style={{
                      backgroundColor: slot.color.contrastText === '#000000' ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.5)',
                      color: slot.color.contrastText === '#000000' ? '#111' : '#fff',
                    }}
                  >
                    {isMorning ? <Sun className="w-3 h-3 text-amber-500" /> : <Moon className="w-3 h-3 text-indigo-400" />}
                    <span>#{idx + 1} · {slot.timeSlot}</span>
                  </span>

                  <span
                    className="px-2 py-0.5 text-[11px] font-mono font-bold rounded-md shadow-xs backdrop-blur-md"
                    style={{
                      backgroundColor: slot.color.contrastText === '#000000' ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.5)',
                      color: slot.color.contrastText === '#000000' ? '#111' : '#fff',
                    }}
                  >
                    {slot.color.hex}
                  </span>
                </div>

                <div style={{ color: slot.color.contrastText }}>
                  <div className="font-bold text-sm leading-tight drop-shadow-xs truncate">
                    {slot.color.name}
                  </div>
                </div>
              </div>

              {/* Body Details */}
              <div className="p-3.5 space-y-3 flex-1 flex flex-col justify-between text-xs">
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-neutral-400 text-[11px]">
                    <span className="font-medium text-neutral-700 dark:text-neutral-300">{dayName}</span>
                    <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300">
                      {slot.timeSlot} MST
                    </span>
                  </div>

                  {/* Queued Message Preview based on Campaign Template */}
                  <div className="p-2 rounded-lg bg-neutral-50 dark:bg-neutral-800/70 border border-neutral-200/70 dark:border-neutral-700/60">
                    <div className="text-[10px] uppercase font-mono text-neutral-400 mb-0.5 flex items-center justify-between">
                      <span>Queued Message</span>
                      {slot.targetTweetId && <span>→ #{slot.targetTweetId.slice(0, 6)}…</span>}
                    </div>
                    <p className="text-neutral-800 dark:text-neutral-200 text-[11px] font-mono leading-snug line-clamp-3 break-words" title={previewMessage}>
                      {previewMessage}
                    </p>
                  </div>
                </div>

                {/* Harmonious companion preview pills */}
                <div className="flex items-center gap-1 pt-1">
                  <span className="w-3 h-3 rounded-full border border-neutral-300 dark:border-neutral-700" style={{ backgroundColor: slot.color.hex }} />
                  {slot.color.companions.slice(0, 3).map((comp, cIdx) => (
                    <span
                      key={cIdx}
                      className="w-3 h-3 rounded-full border border-neutral-300 dark:border-neutral-700"
                      style={{ backgroundColor: comp }}
                      title={comp}
                    />
                  ))}
                  <span className="text-[10px] text-neutral-400 font-mono ml-auto">
                    RGB {slot.color.rgb.r},{slot.color.rgb.g}
                  </span>
                </div>

                {/* Card Controls */}
                <div className="flex items-center gap-2 pt-2 border-t border-neutral-100 dark:border-neutral-800">
                  <button
                    onClick={() => onRerollSlot(slot.slotId)}
                    className="flex-1 py-1.5 px-2 text-xs font-medium text-neutral-700 dark:text-neutral-300 bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 rounded-md transition-colors flex items-center justify-center gap-1 cursor-pointer"
                    title="Generate a new color and message preview for this slot"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Re-roll
                  </button>

                  <button
                    onClick={() => onPostNow(slot.color, slot.slotType)}
                    disabled={isPosting}
                    className="py-1.5 px-2.5 text-xs font-medium text-white bg-neutral-900 hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200 rounded-md transition-colors flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50"
                    title="Send this color reply immediately"
                  >
                    <Send className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
