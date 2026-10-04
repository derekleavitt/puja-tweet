/**
 * X ChromaBot - Clean unboxed footer
 */

import React from 'react';

interface FooterProps {
  activeName: string;
  targetTweetId: string;
}

export const Footer: React.FC<FooterProps> = ({ activeName, targetTweetId }) => {
  return (
    <footer className="border-t border-neutral-200 dark:border-neutral-800 py-6 px-6 text-xs text-neutral-500 bg-white dark:bg-neutral-950">
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-neutral-700 dark:text-neutral-300">X ChromaBot</span>
          <span>·</span>
          <span>Active: {activeName} (#{targetTweetId})</span>
        </div>
        <div className="flex items-center gap-4 text-neutral-400 font-mono text-[11px]">
          <span>Cloud State &amp; Google Auth Active</span>
          <span>·</span>
          <span>Multi-Schedule Context Engine</span>
        </div>
      </div>
    </footer>
  );
};
