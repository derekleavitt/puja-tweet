import React from 'react';
import { Sparkles } from 'lucide-react';
import { TargetTweetEditor } from './TargetTweetEditor.js';

interface HeaderProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onQuickPost: () => void;
  isPosting: boolean;
  dryRun: boolean;
  onToggleDryRun: () => void;
  targetTweetId: string;
  onUpdateTargetTweetId: (newId: string) => Promise<void>;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  onQuickPost,
  isPosting,
  dryRun,
  onToggleDryRun,
  targetTweetId,
  onUpdateTargetTweetId,
}) => {
  const navItems = [
    { id: 'studio', label: 'Studio' },
    { id: 'queue', label: '7-Day Queue' },
    { id: 'history', label: 'Post Logs' },
    { id: 'settings', label: 'Schedule & Template' },
    { id: 'credentials', label: 'X Credentials' },
    { id: 'export', label: 'Cloud Runner' },
  ];

  return (
    <header className="flex items-center justify-between px-6 py-3.5 border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 sticky top-0 z-30">
      {/* Zone 1: Single text element wordmark */}
      <div className="flex items-center gap-3">
        <a
          href="#studio"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab('studio');
          }}
          className="text-lg font-bold tracking-tight text-neutral-900 dark:text-neutral-100 flex items-center gap-2"
        >
          <span className="w-3 h-3 rounded-full bg-gradient-to-tr from-amber-500 via-rose-500 to-indigo-600 inline-block shadow-xs" />
          ChromaBot
        </a>
        <span className="text-xs text-neutral-400 font-mono hidden sm:inline">x.com/pfinallyhere</span>
      </div>

      {/* Zone 2: Clean text navigation links */}
      <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-neutral-600 dark:text-neutral-400">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setActiveTab(item.id)}
            className={`transition-colors whitespace-nowrap ${
              activeTab === item.id
                ? 'text-neutral-900 dark:text-neutral-100 font-semibold'
                : 'hover:text-neutral-900 dark:hover:text-neutral-200'
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {/* Zone 3: 1-2 primary actions + Target status */}
      <div className="flex items-center gap-2.5">
        <div className="hidden lg:block">
          <TargetTweetEditor
            compact
            currentTargetId={targetTweetId}
            onSave={onUpdateTargetTweetId}
          />
        </div>

        <button
          onClick={onToggleDryRun}
          title={dryRun ? 'Dry run mode: replies will be simulated' : 'Live mode: replies will be sent to X API'}
          className={`px-2.5 py-1 text-xs font-mono rounded border transition-colors flex items-center gap-1.5 ${
            dryRun
              ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-800'
              : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800'
          }`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${dryRun ? 'bg-amber-500' : 'bg-emerald-500'}`} />
          {dryRun ? 'Dry Run' : 'Live X API'}
        </button>

        <button
          onClick={onQuickPost}
          disabled={isPosting}
          className="px-3.5 py-1.5 text-xs font-medium text-white bg-neutral-900 dark:bg-neutral-100 dark:text-neutral-900 rounded-md hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors whitespace-nowrap disabled:opacity-50 flex items-center gap-1.5 cursor-pointer shadow-xs"
        >
          {isPosting ? (
            <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <Sparkles className="w-3.5 h-3.5" />
          )}
          Post Reply Now
        </button>
      </div>
    </header>
  );
};
