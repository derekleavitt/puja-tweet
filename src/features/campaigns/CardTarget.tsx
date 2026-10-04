/**
 * X ChromaBot - CardTarget
 * Target post link with a copy-ID button, shown on a campaign card.
 */

import React, { useState } from 'react';
import { ExternalLink, Copy, Check } from 'lucide-react';

interface CardTargetProps {
  targetTweetId: string;
}

export const CardTarget: React.FC<CardTargetProps> = ({ targetTweetId }) => {
  const [copied, setCopied] = useState(false);

  const copyTweetId = () => {
    navigator.clipboard.writeText(targetTweetId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="p-2.5 rounded-lg bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-200/80 dark:border-neutral-700/60 flex items-center justify-between gap-2 text-xs">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-neutral-400 font-mono text-[11px]">Target Post:</span>
        <a
          href={`https://x.com/i/status/${targetTweetId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono font-semibold text-neutral-900 dark:text-neutral-100 hover:text-blue-600 dark:hover:text-blue-400 transition-colors inline-flex items-center gap-1 truncate"
          title="Open target post on X"
        >
          <span className="truncate">#{targetTweetId}</span>
          <ExternalLink className="w-3 h-3 shrink-0" />
        </a>
      </div>
      <button
        onClick={copyTweetId}
        className="p-1 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 rounded transition-colors cursor-pointer shrink-0"
        title="Copy Tweet ID"
      >
        {copied ? (
          <Check className="w-3.5 h-3.5 text-emerald-500" />
        ) : (
          <Copy className="w-3.5 h-3.5" />
        )}
      </button>
    </div>
  );
};
