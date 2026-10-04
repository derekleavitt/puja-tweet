/**
 * X ChromaBot - TweetMockup
 * Reply-card mockup showing the rendered tweet text.
 */

import React from 'react';
import { ColorData } from '../../types.js';

interface TweetMockupProps {
  color: ColorData;
  tweetText: string;
  targetTweetId: string;
  replyTargetMode: 'original_post' | 'last_comment';
  lastPostedTweetId?: string;
}

export const TweetMockup: React.FC<TweetMockupProps> = ({
  color,
  tweetText,
  targetTweetId,
  replyTargetMode,
  lastPostedTweetId,
}) => (
  <div className="space-y-3 pt-1">
    <div className="flex items-center gap-2.5">
      <div
        className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm shadow-xs"
        style={{ backgroundColor: color.hex }}
      >
        🎨
      </div>
      <div>
        <div className="flex items-center gap-1.5 leading-none">
          <span className="font-bold text-sm text-neutral-900 dark:text-neutral-100">
            ChromaBot
          </span>
          <span className="text-xs text-neutral-500">@chromabot</span>
          <span className="text-xs text-neutral-400">· Now</span>
        </div>
        <div className="text-xs text-neutral-500 mt-1">
          Replying to{' '}
          {replyTargetMode === 'last_comment' && lastPostedTweetId ? (
            <span className="text-purple-600 dark:text-purple-400 font-medium">
              our last comment (#{lastPostedTweetId})
            </span>
          ) : (
            <span className="text-blue-500">root post (#{targetTweetId})</span>
          )}
        </div>
      </div>
    </div>

    {/* Formatted Text Box */}
    <div className="bg-neutral-50 dark:bg-neutral-950 p-3.5 rounded-lg border border-neutral-100 dark:border-neutral-800 text-sm font-sans text-neutral-800 dark:text-neutral-200 whitespace-pre-line leading-relaxed selection:bg-neutral-200">
      {tweetText}
    </div>

    {/* Tweet Action Icons */}
    <div className="flex items-center justify-between text-neutral-400 text-xs px-2 pt-1 border-t border-neutral-100 dark:border-neutral-800/60">
      <span>💬 0</span>
      <span>🔁 0</span>
      <span>❤️ 0</span>
      <span>📊 1</span>
    </div>
  </div>
);
