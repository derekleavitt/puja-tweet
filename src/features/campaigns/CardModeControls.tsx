/**
 * X ChromaBot - CardModeControls
 * Compact engagement-format and reply-behaviour toggles shown on a campaign card.
 */

import React from 'react';
import { MessageSquare, Quote, Globe, Link2, Target, RotateCcw } from 'lucide-react';
import { TweetContext } from '../../types.js';

interface CardModeControlsProps {
  context: TweetContext;
  onUpdate: (updates: Partial<TweetContext>) => Promise<void>;
}

const PANEL =
  'p-2.5 rounded-lg bg-neutral-50 dark:bg-neutral-800/40 border border-neutral-200/80 dark:border-neutral-700/60 space-y-1.5 text-xs';
const SEGMENT_WRAP =
  'flex items-center gap-1 bg-neutral-200/70 dark:bg-neutral-700/70 p-0.5 rounded-md';
const SEGMENT_IDLE =
  'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100';

const segment = (active: boolean, activeClass: string) =>
  `px-2 py-0.5 text-[10px] font-medium rounded transition-colors cursor-pointer flex items-center gap-1 ${
    active ? `${activeClass} text-white shadow-xs` : SEGMENT_IDLE
  }`;

export const CardModeControls: React.FC<CardModeControlsProps> = ({ context: ctx, onUpdate }) => {
  const mode = ctx.engagementMode || 'reply';
  const isChain = ctx.replyTargetMode === 'last_comment';

  return (
    <>
      <div className={PANEL}>
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-neutral-600 dark:text-neutral-400">
            Engagement Format
          </span>
          <div className={SEGMENT_WRAP}>
            <button
              type="button"
              onClick={() => onUpdate({ engagementMode: 'reply' })}
              className={segment(mode === 'reply', 'bg-blue-600')}
              title="Comment in thread under root/last tweet"
            >
              <MessageSquare className="w-2.5 h-2.5" />
              <span>Reply Thread</span>
            </button>
            <button
              type="button"
              onClick={() => onUpdate({ engagementMode: 'quote' })}
              className={segment(mode === 'quote', 'bg-amber-600')}
              title="Quote Tweet target post on your timeline (Bypasses in-thread reply restrictions)"
            >
              <Quote className="w-2.5 h-2.5" />
              <span>Quote Tweet</span>
            </button>
            <button
              type="button"
              onClick={() => onUpdate({ engagementMode: 'standalone' })}
              className={segment(mode === 'standalone', 'bg-emerald-600')}
              title="Standalone timeline drop without attaching to post"
            >
              <Globe className="w-2.5 h-2.5" />
              <span>Timeline</span>
            </button>
          </div>
        </div>
        <div className="text-[10px] text-neutral-500">
          {mode === 'reply' && 'Replies directly in the comment thread of the target post.'}
          {mode === 'quote' &&
            'Embeds the target post as an aesthetic Quote Tweet on your profile (bypasses reply cooldowns).'}
          {mode === 'standalone' &&
            'Publishes directly to your timeline without referencing a parent post.'}
        </div>
      </div>

      {mode === 'reply' && (
        <div className={PANEL.replace('space-y-1.5', 'space-y-2')}>
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-neutral-600 dark:text-neutral-400">
              Reply Behavior
            </span>
            <div className={SEGMENT_WRAP}>
              <button
                type="button"
                onClick={() => onUpdate({ replyTargetMode: 'original_post' })}
                className={`px-2 py-0.5 text-[10px] font-medium rounded transition-colors cursor-pointer ${
                  !isChain
                    ? 'bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 shadow-xs'
                    : SEGMENT_IDLE
                }`}
                title="All drops comment directly under the campaign's root post"
              >
                Root Mode
              </button>
              <button
                type="button"
                onClick={() => onUpdate({ replyTargetMode: 'last_comment' })}
                className={`px-2 py-0.5 text-[10px] font-medium rounded transition-colors cursor-pointer ${
                  isChain ? 'bg-purple-600 text-white shadow-xs' : SEGMENT_IDLE
                }`}
                title="Each drop replies to the previous comment, creating a cascading thread"
              >
                Chain Mode
              </button>
            </div>
          </div>

          <div className="text-[11px] text-neutral-600 dark:text-neutral-400 flex items-center justify-between gap-2">
            {isChain ? (
              <div className="flex items-center gap-1.5 min-w-0">
                <Link2 className="w-3.5 h-3.5 text-purple-500 shrink-0" />
                <span className="truncate">
                  {ctx.lastPostedTweetId
                    ? `Chain active: next drop replies to comment #${ctx.lastPostedTweetId}`
                    : `Starting chain: next drop will reply to root #${ctx.targetTweetId}`}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 min-w-0">
                <Target className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                <span className="truncate">
                  All drops reply directly under root post #{ctx.targetTweetId}
                </span>
              </div>
            )}

            {isChain && ctx.lastPostedTweetId && (
              <button
                type="button"
                onClick={() => onUpdate({ lastPostedTweetId: undefined })}
                className="px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded hover:bg-amber-100 transition-colors flex items-center gap-1 cursor-pointer shrink-0"
                title="Restart chain from original root post"
              >
                <RotateCcw className="w-2.5 h-2.5" />
                <span>Reset to Root</span>
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
};
