/**
 * X ChromaBot - TweetPreviewCard
 * Live X reply preview with AI regeneration and the primary post action.
 */

import React from 'react';
import { Send, ExternalLink, ArrowUpRight, Sparkles, RefreshCw, Hash } from 'lucide-react';
import { AiUnavailableBadge } from '../../components/AiUnavailableBadge.js';
import { AI_UNAVAILABLE_HINT, useAiUnavailable } from '../../context/serverInfo.js';
import { TweetMockup } from './TweetMockup.js';

interface TweetPreviewCardProps {
  tweetText: string;
  targetTweetId: string;
  dryRun: boolean;
  replyTargetMode: 'original_post' | 'last_comment';
  lastPostedTweetId?: string;
  hasAgentTag: boolean;
  hasHistoryTag: boolean;
  /** The campaign evolves its hashtags (the preview text is rendered by the server). */
  evolving?: boolean;
  isGeneratingAi: boolean;
  isPosting: boolean;
  onRegenerate: () => void;
  onPost: () => void;
}

export const TweetPreviewCard: React.FC<TweetPreviewCardProps> = ({
  tweetText,
  targetTweetId,
  dryRun,
  replyTargetMode,
  lastPostedTweetId,
  hasAgentTag,
  hasHistoryTag,
  evolving = false,
  isGeneratingAi,
  isPosting,
  onRegenerate,
  onPost,
}) => {
  const aiUnavailable = useAiUnavailable();
  const charCount = tweetText.length;
  const isOverLimit = charCount > 280;

  return (
    <div className="border border-neutral-200 dark:border-neutral-800 rounded-xl p-5 bg-white dark:bg-neutral-900 shadow-xs space-y-4">
      <div className="flex items-center justify-between pb-3 border-b border-neutral-100 dark:border-neutral-800 text-xs">
        <div className="flex items-center gap-2">
          <span className="font-bold text-neutral-900 dark:text-neutral-100 flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
            X Live Reply Preview
          </span>
          <AiUnavailableBadge />
          {hasAgentTag && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800 flex items-center gap-1">
              <Sparkles className="w-2.5 h-2.5 text-purple-500" />
              <span>AI Poetry{hasHistoryTag ? ' + History' : ''}</span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {evolving && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-teal-100 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800 flex items-center gap-1">
              <Hash className="w-2.5 h-2.5" />
              <span>Evolving hashtags</span>
            </span>
          )}
          {(hasAgentTag || evolving) && (
            <button
              type="button"
              onClick={onRegenerate}
              disabled={isGeneratingAi || (hasAgentTag && aiUnavailable)}
              className="p-1 text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-950/60 rounded transition-colors cursor-pointer"
              title={
                hasAgentTag && aiUnavailable
                  ? AI_UNAVAILABLE_HINT
                  : hasAgentTag
                    ? 'Regenerate AI poem'
                    : 'Re-roll hashtags'
              }
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isGeneratingAi ? 'animate-spin' : ''}`} />
            </button>
          )}
          <span
            className={`font-mono tabular-nums ${
              isOverLimit ? 'text-red-500 font-bold' : 'text-neutral-400'
            }`}
          >
            {charCount} / 280
          </span>
        </div>
      </div>

      {/* Target Post Context indicator */}
      <div className="bg-neutral-50 dark:bg-neutral-950/60 rounded-lg p-3 text-xs border border-neutral-200 dark:border-neutral-800 space-y-2">
        <div className="flex items-center justify-between text-neutral-500">
          <span className="flex items-center gap-1.5">
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${replyTargetMode === 'last_comment' ? 'bg-purple-500' : 'bg-blue-500'}`}
            />
            <span>
              {replyTargetMode === 'last_comment'
                ? lastPostedTweetId
                  ? 'Replying to last comment:'
                  : 'Replying to root (starting chain):'
                : 'Replying to root post:'}
            </span>
          </span>
          <div className="flex items-center gap-1 font-mono text-neutral-800 dark:text-neutral-200">
            <a
              href={`https://x.com/i/status/${replyTargetMode === 'last_comment' && lastPostedTweetId ? lastPostedTweetId : targetTweetId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-blue-600 font-medium inline-flex items-center gap-0.5"
            >
              #
              {replyTargetMode === 'last_comment' && lastPostedTweetId
                ? lastPostedTweetId
                : targetTweetId}
              <ArrowUpRight className="w-3 h-3 text-neutral-400" />
            </a>
            {replyTargetMode === 'last_comment' && (
              <span className="text-[10px] font-sans font-semibold px-1.5 py-0.2 rounded bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300">
                Chain
              </span>
            )}
          </div>
        </div>
      </div>

      <TweetMockup
        tweetText={tweetText}
        targetTweetId={targetTweetId}
        replyTargetMode={replyTargetMode}
        lastPostedTweetId={lastPostedTweetId}
      />

      {/* Primary Action Button */}
      <div className="pt-2 space-y-2">
        <button
          onClick={() => onPost()}
          disabled={isPosting || isOverLimit}
          className="w-full py-2.5 px-4 bg-neutral-900 hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200 text-white text-sm font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer shadow-xs"
        >
          {isPosting ? (
            <>
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Posting to X...
            </>
          ) : (
            <>
              <Send className="w-4 h-4" />
              {dryRun ? 'Simulate Post to X' : 'Post Reply to X Now'}
            </>
          )}
        </button>

        <div className="flex items-center justify-between text-[11px] text-neutral-500 px-1">
          <span>
            Mode:{' '}
            <strong className="text-neutral-700 dark:text-neutral-300">
              {dryRun ? 'Dry Run Simulation' : 'Live X API'}
            </strong>
          </span>
          <a
            href={`https://x.com/i/status/${targetTweetId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline hover:text-blue-600 dark:hover:text-blue-400 font-mono inline-flex items-center gap-1"
          >
            Target: #{targetTweetId} <ExternalLink className="w-2.5 h-2.5" />
          </a>
        </div>
      </div>
    </div>
  );
};
