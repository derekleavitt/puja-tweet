import React from 'react';
import { Sun, Moon, RefreshCw, Send, Check } from 'lucide-react';
import { QueueSlot, ColorData } from '../types.js';

interface QueueViewerProps {
  queue: QueueSlot[];
  onRerollSlot: (slotId: string) => void;
  onPostNow: (color: ColorData, slotType: 'morning' | 'evening' | 'manual') => void;
  isPosting: boolean;
}

export const QueueViewer: React.FC<QueueViewerProps> = ({
  queue,
  onRerollSlot,
  onPostNow,
  isPosting,
}) => {
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-neutral-200 dark:border-neutral-800">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
            7-Day Scheduled Queue (14 Drops)
          </h2>
          <p className="text-sm text-neutral-500 mt-0.5">
            Automated colors prepared for the 6:00 AM and 6:00 PM drops. Re-roll or preview any slot in advance.
          </p>
        </div>

        <div className="text-xs text-neutral-500 font-mono">
          <span>{queue.length} Slots Buffered</span>
          <span className="mx-2">·</span>
          <span>Twice Daily Cadence</span>
        </div>
      </div>

      {/* Grid of queue slots */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {queue.map((slot) => {
          const isMorning = slot.slotType === 'morning';
          const dateObj = new Date(slot.dateStr + 'T12:00:00');
          const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

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
                    className="px-2 py-0.5 text-[11px] font-medium rounded-md shadow-xs backdrop-blur-md flex items-center gap-1"
                    style={{
                      backgroundColor: slot.color.contrastText === '#000000' ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.5)',
                      color: slot.color.contrastText === '#000000' ? '#111' : '#fff',
                    }}
                  >
                    {isMorning ? <Sun className="w-3 h-3 text-amber-500" /> : <Moon className="w-3 h-3 text-indigo-400" />}
                    {isMorning ? '6:00 AM' : '6:00 PM'}
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
                <div>
                  <div className="flex items-center justify-between text-neutral-400 text-[11px] mb-1">
                    <span className="font-medium text-neutral-700 dark:text-neutral-300">{dayName}</span>
                    <span className="font-mono">{slot.timeSlot}</span>
                  </div>
                  <p className="text-neutral-600 dark:text-neutral-400 text-xs line-clamp-2 italic">
                    "{slot.color.mood}"
                  </p>
                </div>

                {/* Harmonious companion preview pills */}
                <div className="flex items-center gap-1 pt-1">
                  <span className="w-3 h-3 rounded-full border border-neutral-300 dark:border-neutral-700" style={{ backgroundColor: slot.color.hex }} />
                  {slot.color.companions.slice(0, 3).map((comp, idx) => (
                    <span
                      key={idx}
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
                    title="Generate a new color for this upcoming slot"
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
