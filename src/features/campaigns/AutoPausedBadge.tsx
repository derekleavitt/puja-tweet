/**
 * X ChromaBot - AutoPausedBadge
 * Shown when the scheduler's circuit breaker paused a campaign; the reason is in the tooltip.
 */

import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { TweetContext } from '../../types.js';

export const AutoPausedBadge: React.FC<{ context: TweetContext }> = ({ context }) => {
  if (context.enabled || !context.autoPausedReason) return null;
  return (
    <span
      className="text-[10px] font-semibold px-2 py-0.5 rounded-full border shrink-0 inline-flex items-center gap-1 bg-red-50 dark:bg-red-950/60 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800"
      title={`Auto-paused: ${context.autoPausedReason} Click "Resume" to restart.`}
    >
      <AlertTriangle className="w-3 h-3" />
      Auto-paused
    </span>
  );
};
