/**
 * X ChromaBot - TargetSettings
 * Target tweet input and reply threading strategy.
 */

import React from 'react';
import { ExternalLink, Target, Link2, RotateCcw } from 'lucide-react';
import { extractTweetId } from '../../../shared/tweetId.js';

interface TargetSettingsProps {
  targetTweetId: string;
  onTargetChange: (id: string) => void;
  replyTargetMode: 'original_post' | 'last_comment';
  onModeChange: (mode: 'original_post' | 'last_comment') => void;
  lastPostedTweetId?: string;
  onResetAnchor: () => void;
}

export const TargetSettings: React.FC<TargetSettingsProps> = ({
  targetTweetId,
  onTargetChange,
  replyTargetMode,
  onModeChange,
  lastPostedTweetId,
  onResetAnchor,
}) => (
  <div className="border border-neutral-200 dark:border-neutral-800 rounded-xl p-5 bg-white dark:bg-neutral-900 space-y-3 shadow-xs">
    <div className="flex items-center justify-between">
      <label className="text-xs font-bold uppercase tracking-wider text-neutral-700 dark:text-neutral-300">
        Target Tweet ID / Status
      </label>
      <a
        href={`https://x.com/i/status/${extractTweetId(targetTweetId) || targetTweetId}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1 font-mono"
      >
        Verify Target on X <ExternalLink className="w-3 h-3" />
      </a>
    </div>

    <p className="text-xs text-neutral-500">
      Paste a numeric Tweet ID or a full post URL (e.g.{' '}
      <span className="font-mono">https://x.com/username/status/…</span>).
    </p>

    <input
      type="text"
      value={targetTweetId}
      onChange={(e) => onTargetChange(e.target.value)}
      placeholder="Tweet ID or https://x.com/..."
      className="w-full px-3.5 py-2 text-sm font-mono border border-neutral-300 dark:border-neutral-700 rounded-lg bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-400 dark:focus:ring-neutral-600"
      required
    />

    {extractTweetId(targetTweetId) && extractTweetId(targetTweetId) !== targetTweetId && (
      <div className="text-xs text-emerald-600 dark:text-emerald-400 font-mono">
        ✓ Clean ID detected: {extractTweetId(targetTweetId)}
      </div>
    )}

    {/* Reply Threading Strategy Toggle in Settings */}
    <div className="pt-4 border-t border-neutral-100 dark:border-neutral-800/80 space-y-2.5">
      <div className="flex items-center justify-between">
        <label className="text-xs font-bold uppercase tracking-wider text-neutral-700 dark:text-neutral-300">
          Reply Threading Strategy
        </label>
        <span className="text-[11px] font-mono text-neutral-400">
          {replyTargetMode === 'last_comment' ? 'Cascading Ladder Chain' : 'Direct Root Hub'}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <button
          type="button"
          onClick={() => onModeChange('original_post')}
          className={`p-3 rounded-lg border text-left cursor-pointer transition-all flex flex-col justify-between ${
            replyTargetMode === 'original_post'
              ? 'border-indigo-600 bg-indigo-50/60 dark:bg-indigo-950/40 text-indigo-900 dark:text-indigo-100 font-semibold ring-1 ring-indigo-500/30'
              : 'border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800/60 text-neutral-700 dark:text-neutral-300 hover:border-neutral-300'
          }`}
        >
          <div className="flex items-center gap-1.5 text-xs">
            <Target className="w-3.5 h-3.5 text-blue-500" />
            <span>Reply to Original Post</span>
          </div>
          <div className="text-[11px] text-neutral-500 dark:text-neutral-400 font-normal mt-1 leading-snug">
            All automated drops attach directly under root post (#
            {extractTweetId(targetTweetId) || targetTweetId || '...'}).
          </div>
        </button>

        <button
          type="button"
          onClick={() => onModeChange('last_comment')}
          className={`p-3 rounded-lg border text-left cursor-pointer transition-all flex flex-col justify-between ${
            replyTargetMode === 'last_comment'
              ? 'border-purple-600 bg-purple-50/60 dark:bg-purple-950/40 text-purple-900 dark:text-purple-100 font-semibold ring-1 ring-purple-500/30'
              : 'border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800/60 text-neutral-700 dark:text-neutral-300 hover:border-neutral-300'
          }`}
        >
          <div className="flex items-center gap-1.5 text-xs">
            <Link2 className="w-3.5 h-3.5 text-purple-500" />
            <span>Reply to Last Comment</span>
          </div>
          <div className="text-[11px] text-neutral-500 dark:text-neutral-400 font-normal mt-1 leading-snug">
            Each next drop replies to the previous comment made by us, forming an unbroken cascading
            thread.
          </div>
        </button>
      </div>

      {replyTargetMode === 'last_comment' && (
        <div className="p-2.5 rounded-lg bg-purple-50/70 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800/60 text-xs flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-2 h-2 rounded-full bg-purple-500 shrink-0" />
            <div className="truncate text-purple-900 dark:text-purple-200 text-[11px]">
              {lastPostedTweetId ? (
                <span>
                  Current chain anchor: <strong className="font-mono">#{lastPostedTweetId}</strong>
                </span>
              ) : (
                <span>
                  No prior comment recorded. First drop will reply to root post{' '}
                  <strong className="font-mono">
                    #{extractTweetId(targetTweetId) || targetTweetId}
                  </strong>{' '}
                  to begin the chain.
                </span>
              )}
            </div>
          </div>

          {lastPostedTweetId && (
            <button
              type="button"
              onClick={() => onResetAnchor()}
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
  </div>
);
