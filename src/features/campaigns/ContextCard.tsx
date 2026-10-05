/**
 * X ChromaBot - ContextCard
 * One campaign card: status, target, schedule, modes, template, history, actions.
 */

import React from 'react';
import { Play, Pause, Trash2, Check, AlertCircle, History } from 'lucide-react';
import { TweetContext } from '../../types.js';
import { CardTarget } from './CardTarget.js';
import { CardFrequency } from './CardFrequency.js';
import { CardModeControls } from './CardModeControls.js';
import { CardActions } from './CardActions.js';
import { AutoPausedBadge } from './AutoPausedBadge.js';
import { CardHashtags } from './CardHashtags.js';

export interface TriggerNotice {
  success: boolean;
  message: string;
}

interface ContextCardProps {
  context: TweetContext;
  isActive: boolean;
  countdown?: string;
  isTriggering: boolean;
  notice: TriggerNotice | null;
  canDelete: boolean;
  onSelectActive: () => void;
  onUpdate: (updates: Partial<TweetContext>) => Promise<void>;
  onToggle: () => void;
  onTrigger: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onRequestClearHistory?: () => void;
  onRequestDelete: () => void;
}

const BADGE = 'text-[10px] font-semibold px-2 py-0.5 rounded-full border shrink-0';
const MODE_BADGES = {
  quote: {
    label: 'Quote Tweet',
    className:
      'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800',
  },
  standalone: {
    label: 'Timeline Drop',
    className:
      'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
  },
  reply: {
    label: 'Direct Reply',
    className:
      'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800',
  },
};

export const ContextCard: React.FC<ContextCardProps> = (props) => {
  const { context: ctx, isActive, notice } = props;
  const badge = MODE_BADGES[ctx.engagementMode || 'reply'];

  return (
    <div
      className={`border rounded-xl p-5 bg-white dark:bg-neutral-900 transition-all flex flex-col justify-between gap-4 ${
        isActive
          ? 'border-indigo-500 dark:border-indigo-400 ring-2 ring-indigo-500/20 shadow-sm'
          : 'border-neutral-200 dark:border-neutral-800 hover:border-neutral-300 dark:hover:border-neutral-700'
      }`}
    >
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-bold text-neutral-900 dark:text-neutral-100 truncate">
                {ctx.name}
              </h3>
              {isActive && (
                <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 shrink-0">
                  Active in Studio
                </span>
              )}
              <span className={`${BADGE} ${badge.className}`}>{badge.label}</span>
              <AutoPausedBadge context={ctx} />
            </div>
            {ctx.description && (
              <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5 line-clamp-1">
                {ctx.description}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={props.onToggle}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all flex items-center gap-1.5 cursor-pointer shrink-0 ${
              ctx.enabled
                ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 shadow-xs'
                : 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-800 hover:bg-amber-100 dark:hover:bg-amber-900/40'
            }`}
            title={ctx.enabled ? 'Click to Pause this campaign' : 'Click to Resume this campaign'}
          >
            {ctx.enabled ? (
              <Pause className="w-3.5 h-3.5 fill-current" />
            ) : (
              <Play className="w-3.5 h-3.5 fill-current" />
            )}
            <span>{ctx.enabled ? 'Active' : ctx.autoPausedReason ? 'Resume' : 'Paused'}</span>
          </button>
        </div>

        <CardTarget targetTweetId={ctx.targetTweetId} />

        <CardFrequency context={ctx} countdown={props.countdown} onUpdate={props.onUpdate} />
        <CardModeControls context={ctx} onUpdate={props.onUpdate} />

        <div className="text-xs">
          <span className="text-[10px] uppercase font-mono text-neutral-400">Template:</span>
          <div className="mt-1 p-2 rounded-md bg-neutral-100/70 dark:bg-neutral-800/80 font-mono text-[11px] text-neutral-700 dark:text-neutral-300 break-words">
            {ctx.template}
          </div>
        </div>

        <CardHashtags context={ctx} />

        <div className="p-2.5 rounded-lg bg-neutral-50 dark:bg-neutral-800/50 border border-neutral-200/70 dark:border-neutral-700/60 flex items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 min-w-0">
            <History className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
            <div className="min-w-0 truncate">
              <span className="font-medium text-neutral-700 dark:text-neutral-300">
                History: {ctx.stats?.totalPosts || 0} drops
              </span>
              {ctx.stats && ctx.stats.totalPosts > 0 && (
                <span className="text-[10px] text-neutral-400 ml-1.5 font-mono">
                  ({ctx.stats.successfulPosts} sent, {ctx.stats.failedPosts} failed)
                </span>
              )}
            </div>
          </div>

          {props.onRequestClearHistory && (
            <button
              type="button"
              onClick={props.onRequestClearHistory}
              className="px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100 dark:hover:bg-amber-900/60 rounded border border-amber-200 dark:border-amber-800 transition-colors flex items-center gap-1 cursor-pointer shrink-0"
              title="Clear history and reset stats for this campaign"
            >
              <Trash2 className="w-3 h-3" />
              <span>Clear History</span>
            </button>
          )}
        </div>

        {notice && (
          <div
            className={`p-2 rounded-lg text-xs flex items-center gap-2 ${
              notice.success
                ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                : 'bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800'
            }`}
          >
            {notice.success ? (
              <Check className="w-3.5 h-3.5 shrink-0" />
            ) : (
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            )}
            <span>{notice.message}</span>
          </div>
        )}
      </div>

      <CardActions {...props} />
    </div>
  );
};
