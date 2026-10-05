/**
 * X ChromaBot - CardHashtags
 * The "Current hashtags" line on a campaign card (only when hashtag evolution is on).
 */

import React from 'react';
import { Hash } from 'lucide-react';
import { TweetContext } from '../../types.js';

interface CardHashtagsProps {
  context: TweetContext;
}

export const CardHashtags: React.FC<CardHashtagsProps> = ({ context }) => {
  if (!context.hashtagEvolution?.enabled) return null;
  const current = context.hashtagState?.current ?? [];

  return (
    <div className="text-xs flex items-center gap-1.5 flex-wrap" data-testid="current-hashtags">
      <Hash className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400 shrink-0" />
      <span className="text-[10px] uppercase font-mono text-neutral-400">Current hashtags:</span>
      {current.length > 0 ? (
        current.map((tag) => (
          <span
            key={tag}
            className="px-1.5 py-0.5 rounded bg-teal-50 dark:bg-teal-950/50 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800 font-mono text-[11px]"
          >
            #{tag}
          </span>
        ))
      ) : (
        <span className="text-[11px] text-neutral-500">evolving from your template (none yet)</span>
      )}
    </div>
  );
};
