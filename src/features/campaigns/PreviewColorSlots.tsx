/**
 * X ChromaBot - PreviewColorSlots
 * Color palette re-roll for a campaign preview. Only rendered when the campaign template uses a
 * color token (`templateUsesColor`); for other templates the color changes nothing visible.
 */

import React from 'react';
import { Sun, Moon, Shuffle } from 'lucide-react';
import { PreviewSlot } from './useCampaignPreview.js';

const SLOTS = [
  { slot: 'morning', label: 'Morning', Icon: Sun },
  { slot: 'evening', label: 'Evening', Icon: Moon },
  { slot: 'manual', label: 'Random', Icon: Shuffle },
] as const;

interface PreviewColorSlotsProps {
  selected: PreviewSlot;
  disabled: boolean;
  onPick: (slot: PreviewSlot) => void;
}

export const PreviewColorSlots: React.FC<PreviewColorSlotsProps> = ({
  selected,
  disabled,
  onPick,
}) => (
  <div
    className="flex items-center gap-1 p-0.5 bg-neutral-100 dark:bg-neutral-800 rounded-md text-[11px] w-fit"
    title="This template uses a color token: pick the palette to re-roll the color"
  >
    <span className="pl-1.5 pr-0.5 font-semibold text-neutral-500">Color:</span>
    {SLOTS.map(({ slot, label, Icon }) => (
      <button
        key={slot}
        type="button"
        disabled={disabled}
        onClick={() => onPick(slot)}
        className={`px-2 py-0.5 font-medium rounded transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-60 ${
          selected === slot
            ? 'bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 shadow-xs'
            : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200'
        }`}
      >
        <Icon className="w-3 h-3 text-neutral-400" />
        {label}
      </button>
    ))}
  </div>
);
