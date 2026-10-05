/**
 * X ChromaBot - CardHashtags
 * The hashtags line on a campaign card: the campaign's own Hashtags, or (when evolution is on) the
 * tags its last post used.
 */

import React from 'react';
import { Hash } from 'lucide-react';
import { TweetContext } from '../../types.js';

interface CardHashtagsProps {
  context: TweetContext;
}

const CHIP =
  'px-1.5 py-0.5 rounded bg-teal-50 dark:bg-teal-950/50 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800 font-mono text-[11px]';

export const CardHashtags: React.FC<CardHashtagsProps> = ({ context }) => {
  if (!context.hashtagEvolution?.enabled) {
    const own = context.hashtags ?? [];
    if (own.length === 0) return null;
    return (
      <div className="text-xs flex items-center gap-1.5 flex-wrap" data-testid="campaign-tags">
        <Hash className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400 shrink-0" />
        <span className="text-[10px] uppercase font-mono text-neutral-400">Hashtags:</span>
        {own.map((tag) => (
          <span key={tag} className={CHIP}>
            #{tag}
          </span>
        ))}
      </div>
    );
  }
  const current = context.hashtagState?.current ?? [];

  return (
    <div className="text-xs flex items-center gap-1.5 flex-wrap" data-testid="current-hashtags">
      <Hash className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400 shrink-0" />
      <span className="text-[10px] uppercase font-mono text-neutral-400">Current hashtags:</span>
      {current.length > 0 ? (
        current.map((tag) => (
          <span key={tag} className={CHIP}>
            #{tag}
          </span>
        ))
      ) : (
        <span className="text-[11px] text-neutral-500">evolving from your Hashtags (none yet)</span>
      )}
    </div>
  );
};
