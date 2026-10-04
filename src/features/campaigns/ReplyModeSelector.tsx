/**
 * X ChromaBot - ReplyModeSelector
 * Form control: reply to the root post vs chain onto the last comment.
 */

import React from 'react';
import { Target, Link2, RotateCcw } from 'lucide-react';
import { TweetContext } from '../../types.js';
import { LABEL_CLASS, OPTION_BASE_CLASS, OPTION_IDLE_CLASS } from './constants.js';

interface ReplyModeSelectorProps {
  context: Partial<TweetContext>;
  onChange: (fields: Partial<TweetContext>) => void;
}

export const ReplyModeSelector: React.FC<ReplyModeSelectorProps> = ({ context, onChange }) => {
  const isChain = context.replyTargetMode === 'last_comment';
  return (
    <div className="space-y-2 pt-2 border-t border-neutral-100 dark:border-neutral-800">
      <div className="flex items-center justify-between">
        <label className={LABEL_CLASS}>Reply Threading Strategy</label>
        <span className="text-[11px] font-mono text-neutral-400">
          {isChain ? 'Cascading Chain' : 'Root Anchor'}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => onChange({ replyTargetMode: 'original_post' })}
          className={`p-3 ${OPTION_BASE_CLASS} ${
            (context.replyTargetMode || 'original_post') === 'original_post'
              ? 'border-indigo-600 bg-indigo-50/60 dark:bg-indigo-950/40 text-indigo-900 dark:text-indigo-100 font-semibold ring-1 ring-indigo-500/30'
              : OPTION_IDLE_CLASS
          }`}
        >
          <div className="flex items-center gap-1.5 text-xs">
            <Target className="w-3.5 h-3.5 text-blue-500" />
            <span>Reply to Original Post</span>
          </div>
          <div className="text-[10px] text-neutral-500 dark:text-neutral-400 font-normal mt-1 leading-snug">
            All drops reply directly to the root post (#{context.targetTweetId || '...'}).
          </div>
        </button>

        <button
          type="button"
          onClick={() => onChange({ replyTargetMode: 'last_comment' })}
          className={`p-3 ${OPTION_BASE_CLASS} ${
            isChain
              ? 'border-purple-600 bg-purple-50/60 dark:bg-purple-950/40 text-purple-900 dark:text-purple-100 font-semibold ring-1 ring-purple-500/30'
              : OPTION_IDLE_CLASS
          }`}
        >
          <div className="flex items-center gap-1.5 text-xs">
            <Link2 className="w-3.5 h-3.5 text-purple-500" />
            <span>Reply to Last Comment</span>
          </div>
          <div className="text-[10px] text-neutral-500 dark:text-neutral-400 font-normal mt-1 leading-snug">
            Each next drop replies to the last comment made by us, forming an unbroken cascading
            thread.
          </div>
        </button>
      </div>

      {isChain && (
        <div className="p-2.5 rounded-lg bg-purple-50/70 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800/60 text-xs flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-2 h-2 rounded-full bg-purple-500 shrink-0" />
            <div className="truncate text-purple-900 dark:text-purple-200 text-[11px]">
              {context.lastPostedTweetId ? (
                <span>
                  Current chain anchor:{' '}
                  <strong className="font-mono">#{context.lastPostedTweetId}</strong>
                </span>
              ) : (
                <span>
                  No prior comment recorded. First drop will reply to root post{' '}
                  <strong className="font-mono">#{context.targetTweetId}</strong> to begin the
                  chain.
                </span>
              )}
            </div>
          </div>

          {context.lastPostedTweetId && (
            <button
              type="button"
              onClick={() => onChange({ lastPostedTweetId: undefined })}
              className="px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-950/60 rounded border border-amber-300 dark:border-amber-800 hover:bg-amber-200 cursor-pointer flex items-center gap-1 shrink-0"
              title="Reset chain anchor back to original post"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset to Root</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};
