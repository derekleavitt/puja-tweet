/**
 * X ChromaBot - CardActions
 * Footer action row of a campaign card.
 */

import React from 'react';
import { Edit2, Copy, Trash2, Sparkles, History } from 'lucide-react';

interface CardActionsProps {
  isActive: boolean;
  isTriggering: boolean;
  canDelete: boolean;
  onSelectActive: () => void;
  onTrigger: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onRequestClearHistory?: () => void;
  onRequestDelete: () => void;
}

const ICON_BTN =
  'p-1.5 text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-md transition-colors cursor-pointer';

export const CardActions: React.FC<CardActionsProps> = (props) => (
  <div className="pt-3 border-t border-neutral-100 dark:border-neutral-800 flex items-center justify-between gap-2 flex-wrap">
    <div className="flex items-center gap-1.5">
      {!props.isActive && (
        <button
          onClick={props.onSelectActive}
          className="px-2.5 py-1 text-xs font-medium text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-md transition-colors cursor-pointer"
        >
          Set Active
        </button>
      )}
      <button
        onClick={props.onTrigger}
        disabled={props.isTriggering}
        className="px-2.5 py-1 text-xs font-medium text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/60 hover:bg-indigo-100 dark:hover:bg-indigo-950 rounded-md border border-indigo-200 dark:border-indigo-800 transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
      >
        {props.isTriggering ? (
          <span className="w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
        ) : (
          <Sparkles className="w-3 h-3" />
        )}
        <span>Trigger Drop</span>
      </button>
    </div>

    <div className="flex items-center gap-1">
      <button onClick={props.onEdit} className={ICON_BTN} title="Edit context & schedule">
        <Edit2 className="w-3.5 h-3.5" />
      </button>
      <button onClick={props.onDuplicate} className={ICON_BTN} title="Duplicate context">
        <Copy className="w-3.5 h-3.5" />
      </button>
      {props.onRequestClearHistory && (
        <button
          onClick={props.onRequestClearHistory}
          className="p-1.5 text-neutral-400 hover:text-amber-600 dark:hover:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/40 rounded-md transition-colors cursor-pointer"
          title="Clear history for this campaign"
        >
          <History className="w-3.5 h-3.5" />
        </button>
      )}
      {props.canDelete && (
        <button
          onClick={props.onRequestDelete}
          className="p-1.5 text-neutral-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-md transition-colors cursor-pointer"
          title="Delete context"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  </div>
);
