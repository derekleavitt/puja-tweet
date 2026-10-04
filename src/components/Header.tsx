import React, { useState, useRef, useEffect } from 'react';
import {
  Sparkles,
  LogOut,
  UserCheck,
  Menu,
  X,
  Layers,
  Calendar,
  FileText,
  Clock,
  Key,
  Radio,
  Activity,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.js';
import { TweetContext, RateLimitTelemetry, CooldownState } from '../types.js';

interface HeaderProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onQuickPost: () => void;
  isPosting: boolean;
  dryRun: boolean;
  onToggleDryRun: () => void;
  targetTweetId: string;
  onUpdateTargetTweetId: (newId: string) => Promise<void>;
  contexts?: TweetContext[];
  activeContextId?: string;
  onSelectContext?: (id: string) => void;
  rateLimitTelemetry?: RateLimitTelemetry | null;
  cooldownState?: CooldownState | null;
  onOpenRateLimits?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  onQuickPost,
  isPosting,
  dryRun,
  onToggleDryRun,
  contexts = [],
  activeContextId = '',
  onSelectContext,
  rateLimitTelemetry,
  cooldownState,
  onOpenRateLimits,
}) => {
  const { user, signOut } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const navItems = [
    { id: 'studio', label: 'Studio', icon: Sparkles },
    { id: 'contexts', label: 'Campaigns', icon: Layers },
    { id: 'queue', label: 'Queue', icon: Calendar },
    { id: 'history', label: 'Logs', icon: FileText },
    { id: 'settings', label: 'Timing', icon: Clock },
    { id: 'credentials', label: 'API Keys', icon: Key },
    { id: 'export', label: 'Ping', icon: Radio },
  ];

  // Close mobile drawer on escape or outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMobileMenuOpen(false);
      }
    }
    if (mobileMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [mobileMenuOpen]);

  const handleSignOut = async () => {
    setIsLoggingOut(true);
    try {
      await signOut();
    } catch (err) {
      console.error('Sign out error:', err);
    } finally {
      setIsLoggingOut(false);
      setMobileMenuOpen(false);
    }
  };

  return (
    <header className="w-full max-w-full border-b border-neutral-200 dark:border-neutral-800 bg-white/95 dark:bg-neutral-950/95 backdrop-blur-md sticky top-0 z-40 transition-colors">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 w-full">
        <div className="flex items-center justify-between h-14 sm:h-16 gap-2 sm:gap-3 w-full min-w-0">
          {/* Left: Brand & Context Quick Switcher */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <a
              href="#studio"
              onClick={(e) => {
                e.preventDefault();
                setActiveTab('studio');
                setMobileMenuOpen(false);
              }}
              className="text-base sm:text-lg font-bold tracking-tight text-neutral-900 dark:text-neutral-100 flex items-center gap-2 group"
            >
              <span className="w-3.5 h-3.5 rounded-full bg-gradient-to-tr from-amber-500 via-rose-500 to-indigo-600 inline-block shadow-xs group-hover:scale-110 transition-transform shrink-0" />
              <span className="truncate">ChromaBot</span>
            </a>

            {/* Context Quick Switcher Dropdown */}
            {contexts.length > 0 && (
              <div className="flex items-center gap-1.5 bg-neutral-100 dark:bg-neutral-900 px-2 py-1 rounded-md border border-neutral-200 dark:border-neutral-800 text-xs shadow-2xs shrink-0 max-w-[130px] sm:max-w-[200px]">
                <Layers className="w-3 h-3 text-indigo-500 shrink-0" />
                <select
                  value={activeContextId}
                  onChange={(e) => onSelectContext?.(e.target.value)}
                  className="bg-transparent font-medium text-neutral-800 dark:text-neutral-200 focus:outline-none cursor-pointer truncate text-[11px] sm:text-xs w-full"
                  title="Switch active tweet context"
                >
                  {contexts.map((c) => (
                    <option
                      key={c.id}
                      value={c.id}
                      className="bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100"
                    >
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Center: Desktop Navigation Tabs (Visible on 2xl / xl) */}
          <nav className="hidden 2xl:flex items-center gap-1 text-sm font-medium text-neutral-600 dark:text-neutral-400 shrink-0">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`px-2.5 py-1.5 rounded-md transition-all text-xs font-medium flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                    isActive
                      ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900 font-semibold shadow-xs'
                      : 'hover:bg-neutral-100 dark:hover:bg-neutral-900 hover:text-neutral-900 dark:hover:text-neutral-100'
                  }`}
                >
                  <Icon
                    className={`w-3.5 h-3.5 ${isActive ? 'text-amber-400 dark:text-neutral-900' : 'text-neutral-400'}`}
                  />
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* Right: Actions, Quick Controls & Dedicated Log Out */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {/* Rate Limits & Quota Badge Button */}
            <button
              type="button"
              onClick={onOpenRateLimits}
              title="Click to view live X rate limit quota, 24-hour caps, and anti-spam heuristics"
              className={`px-2 py-1 text-xs font-mono rounded-md border transition-colors flex items-center gap-1.5 cursor-pointer shrink-0 ${
                cooldownState?.isThrottled
                  ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-300 dark:border-rose-800 animate-pulse'
                  : (rateLimitTelemetry?.remaining ?? 50) < 5
                    ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-800'
                    : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 border-neutral-200 dark:border-neutral-700 hover:bg-neutral-200 dark:hover:bg-neutral-700'
              }`}
            >
              <Activity className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
              <span className="hidden sm:inline font-semibold">
                {cooldownState?.isThrottled
                  ? `Cooldown (${Math.floor(cooldownState.secondsRemaining / 60)}m)`
                  : `X Quota: ${rateLimitTelemetry?.remaining ?? 50}/${rateLimitTelemetry?.limit ?? 50}`}
              </span>
              <span className="sm:hidden font-semibold">
                {cooldownState?.isThrottled ? 'Locked' : `${rateLimitTelemetry?.remaining ?? 50}r`}
              </span>
            </button>

            {/* Dry Run / Live Switch Indicator */}
            <button
              onClick={onToggleDryRun}
              title={
                dryRun ? 'Dry run mode: replies simulated' : 'Live mode: replies sent to X API'
              }
              className={`px-2 py-1 text-xs font-mono rounded-md border transition-colors flex items-center gap-1.5 cursor-pointer shrink-0 ${
                dryRun
                  ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-800 hover:bg-amber-100 dark:hover:bg-amber-950/60'
                  : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-950/60'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${dryRun ? 'bg-amber-500' : 'bg-emerald-500'}`}
              />
              <span className="hidden sm:inline">{dryRun ? 'Dry Run' : 'Live X API'}</span>
              <span className="sm:hidden">{dryRun ? 'Sim' : 'Live'}</span>
            </button>

            {/* Quick Trigger CTA */}
            <button
              onClick={onQuickPost}
              disabled={isPosting}
              className="px-2.5 sm:px-3 py-1 text-xs font-medium text-white bg-neutral-900 dark:bg-neutral-100 dark:text-neutral-900 rounded-md hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors whitespace-nowrap disabled:opacity-50 flex items-center gap-1.5 cursor-pointer shadow-xs shrink-0"
            >
              {isPosting ? (
                <span className="w-3 h-3 border-2 border-white/30 border-t-white dark:border-neutral-900/30 dark:border-t-neutral-900 rounded-full animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5 shrink-0" />
              )}
              <span className="hidden sm:inline">Post Reply</span>
              <span className="sm:hidden">Post</span>
            </button>

            {/* Dedicated Log Out Button & User info */}
            {user && (
              <div className="flex items-center gap-1.5 pl-1.5 sm:pl-2 border-l border-neutral-200 dark:border-neutral-800 shrink-0">
                <div
                  title={`Signed in as ${user.email}`}
                  className="hidden 2xl:flex items-center gap-1 text-[11px] font-mono text-neutral-600 dark:text-neutral-300 bg-neutral-100 dark:bg-neutral-900 px-2 py-1 rounded-md max-w-[120px] truncate"
                >
                  <UserCheck className="w-3 h-3 text-emerald-500 shrink-0" />
                  <span className="truncate">{user.email?.split('@')[0]}</span>
                </div>

                <button
                  onClick={handleSignOut}
                  disabled={isLoggingOut}
                  title={`Log out (${user.email})`}
                  className="px-2 sm:px-2.5 py-1 text-xs font-medium text-neutral-700 dark:text-neutral-300 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-md border border-neutral-200 dark:border-neutral-800 transition-colors flex items-center gap-1.5 cursor-pointer shrink-0"
                >
                  <LogOut className="w-3.5 h-3.5 shrink-0" />
                  <span className="hidden sm:inline">Log out</span>
                </button>
              </div>
            )}

            {/* Mobile & Tablet Hamburger Toggle */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="2xl:hidden p-1.5 text-neutral-600 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-900 rounded-md transition-colors cursor-pointer shrink-0"
              aria-label="Toggle navigation menu"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile & Tablet Drawer Menu */}
      {mobileMenuOpen && (
        <div
          ref={menuRef}
          className="2xl:hidden border-t border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-4 pt-3 pb-4 space-y-3 shadow-xl animate-in slide-in-from-top-2 duration-150 max-h-[85vh] overflow-y-auto"
        >
          {/* Navigation Links Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    setActiveTab(item.id);
                    setMobileMenuOpen(false);
                  }}
                  className={`p-2.5 rounded-lg text-left transition-colors flex items-center gap-2 text-xs font-medium cursor-pointer ${
                    isActive
                      ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900 font-semibold shadow-xs'
                      : 'bg-neutral-50 dark:bg-neutral-900 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </div>

          {/* User Profile & Full-Width Log Out */}
          {user && (
            <div className="pt-3 border-t border-neutral-100 dark:border-neutral-900 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div className="flex items-center gap-2 text-xs text-neutral-600 dark:text-neutral-400 min-w-0">
                <UserCheck className="w-4 h-4 text-emerald-500 shrink-0" />
                <span className="truncate font-mono">{user.email}</span>
              </div>
              <button
                onClick={handleSignOut}
                disabled={isLoggingOut}
                className="w-full sm:w-auto px-4 py-2 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-md border border-red-200 dark:border-red-900/60 transition-colors flex items-center justify-center gap-2 cursor-pointer shrink-0"
              >
                <LogOut className="w-4 h-4 shrink-0" />
                <span>Log out of ChromaBot</span>
              </button>
            </div>
          )}
        </div>
      )}
    </header>
  );
};
