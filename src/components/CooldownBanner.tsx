/**
 * X ChromaBot - Anti-spam cooldown alert banner
 */

import React from 'react';
import { Clock } from 'lucide-react';
import { CooldownState } from '../types.js';

interface CooldownBannerProps {
  cooldownState: CooldownState;
  onClearCooldown: () => void;
}

export const CooldownBanner: React.FC<CooldownBannerProps> = ({
  cooldownState,
  onClearCooldown,
}) => {
  return (
    <div className="mb-6 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-start justify-between gap-4">
      <div className="flex items-start gap-3 min-w-0">
        <div className="p-2 rounded-lg bg-amber-500/20 text-amber-500 shrink-0">
          <Clock className="w-5 h-5 animate-pulse" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="font-semibold text-amber-700 dark:text-amber-300 text-sm">
              X Anti-Spam Cooldown Active
            </h4>
            <span className="px-2 py-0.5 text-xs font-mono font-medium rounded-full bg-amber-500/20 text-amber-700 dark:text-amber-300">
              {Math.floor(cooldownState.secondsRemaining / 60)}m{' '}
              {cooldownState.secondsRemaining % 60}s remaining
            </span>
          </div>
          <p className="text-xs text-neutral-600 dark:text-neutral-400 mt-1">
            {cooldownState.reason ||
              'X temporarily throttled automated in-thread replies on your account. Automated drops are held in safe standby to allow X to reset the cooldown cleanly.'}
          </p>
          <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5">
            Tip: Use{' '}
            <strong className="text-neutral-700 dark:text-neutral-300">Quote Tweet mode</strong> or{' '}
            <strong className="text-neutral-700 dark:text-neutral-300">Dry-Run simulation</strong>{' '}
            while in-thread comments cool down.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={onClearCooldown}
          className="px-3 py-1.5 text-xs font-medium rounded-lg bg-amber-600 hover:bg-amber-700 text-white transition-colors cursor-pointer"
          title="Override and clear cooldown immediately"
        >
          Clear Cooldown
        </button>
      </div>
    </div>
  );
};
