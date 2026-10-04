/**
 * X ChromaBot - StudioHeader
 * Studio title, context picker and quick slot generators.
 */

import React from 'react';
import { Sun, Moon, Shuffle, ArrowUpRight, Layers } from 'lucide-react';
import { TweetContext } from '../../types.js';

export type StudioSlot = 'morning' | 'evening' | 'manual';

const SLOTS = [
  { slot: 'morning', label: '6:00 AM Dawn', Icon: Sun, iconClass: 'text-amber-500' },
  { slot: 'evening', label: '6:00 PM Dusk', Icon: Moon, iconClass: 'text-indigo-400' },
  { slot: 'manual', label: 'Random Pick', Icon: Shuffle, iconClass: 'text-rose-500' },
] as const;

interface StudioHeaderProps {
  contexts: TweetContext[];
  activeContextId: string;
  targetTweetId: string;
  selectedSlot: StudioSlot;
  onSelectContext?: (id: string) => Promise<void>;
  onPickSlot: (slot: StudioSlot) => void;
}

export const StudioHeader: React.FC<StudioHeaderProps> = ({
  contexts,
  activeContextId,
  targetTweetId,
  selectedSlot,
  onSelectContext,
  onPickSlot,
}) => (
  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-neutral-200 dark:border-neutral-800">
    <div>
      <div className="flex items-center gap-2.5 flex-wrap">
        <h1 className="text-xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
          Chromatic Post Studio
        </h1>
        {contexts.length > 0 && (
          <div className="flex items-center gap-1.5 bg-neutral-100 dark:bg-neutral-800 px-2.5 py-1 rounded-lg border border-neutral-200 dark:border-neutral-700 text-xs">
            <Layers className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
            <span className="font-semibold text-neutral-500">Context:</span>
            <select
              value={activeContextId}
              onChange={(e) => onSelectContext?.(e.target.value)}
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
        Replying to X status{' '}
        <a
          href={`https://x.com/i/status/${targetTweetId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-neutral-800 dark:text-neutral-200 underline hover:text-blue-600 inline-flex items-center gap-0.5"
        >
          #{targetTweetId}
          <ArrowUpRight className="w-3.5 h-3.5" />
        </a>
      </p>
    </div>

    {/* Quick Slot Generator Selectors */}
    <div className="flex items-center gap-1.5 p-1 bg-neutral-100 dark:bg-neutral-900 rounded-lg self-start sm:self-auto">
      {SLOTS.map(({ slot, label, Icon, iconClass }) => (
        <button
          key={slot}
          onClick={() => onPickSlot(slot)}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 cursor-pointer ${
            selectedSlot === slot
              ? 'bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 shadow-xs'
              : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200'
          }`}
        >
          <Icon className={`w-3.5 h-3.5 ${iconClass}`} />
          {label}
        </button>
      ))}
    </div>
  </div>
);
