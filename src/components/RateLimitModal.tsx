import React, { useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Flame,
  Info,
  RefreshCw,
  ShieldAlert,
  X,
  Zap,
  DollarSign,
  Quote,
} from 'lucide-react';
import { RateLimitTelemetry, CooldownState } from '../types.js';

interface RateLimitModalProps {
  isOpen: boolean;
  onClose: () => void;
  telemetry: RateLimitTelemetry | null;
  cooldownState: CooldownState | null;
  onClearCooldown: () => Promise<void>;
  onRefreshTelemetry: () => Promise<void>;
}

export const RateLimitModal: React.FC<RateLimitModalProps> = ({
  isOpen,
  onClose,
  telemetry,
  cooldownState,
  onClearCooldown,
  onRefreshTelemetry,
}) => {
  const [activeTab, setActiveTab] = useState<'status' | 'reference' | 'heuristics'>('status');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  if (!isOpen) return null;

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await onRefreshTelemetry();
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleClear = async () => {
    setIsClearing(true);
    try {
      await onClearCooldown();
    } finally {
      setIsClearing(false);
    }
  };

  const remaining = telemetry?.remaining ?? 50;
  const limit = telemetry?.limit ?? 50;
  const percentRemaining = Math.max(0, Math.min(100, Math.round((remaining / (limit || 1)) * 100)));
  const posts24h = telemetry?.postsLast24Hours ?? 0;
  const dailyCap = telemetry?.estimatedDailyCap ?? 10000;
  const percentDailyUsed = Math.min(100, Math.round((posts24h / (dailyCap || 1)) * 100));

  const isThrottled = cooldownState?.isThrottled || telemetry?.status === 'throttled';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs">
      <div className="relative w-full max-w-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between bg-neutral-50/80 dark:bg-neutral-900/80">
          <div className="flex items-center gap-2.5">
            <div
              className={`p-2 rounded-xl ${isThrottled ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400' : 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400'}`}
            >
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-neutral-900 dark:text-neutral-100 flex items-center gap-2 text-base sm:text-lg">
                <span>X API Rate Limits &amp; Quota Telemetry</span>
                <span
                  className={`text-[11px] font-mono px-2 py-0.5 rounded-full border ${
                    isThrottled
                      ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800'
                      : remaining < 5
                        ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800'
                        : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                  }`}
                >
                  {isThrottled
                    ? 'Throttled / Cooldown'
                    : remaining < 5
                      ? 'Warning: Low Quota'
                      : 'Optimal Pacing'}
                </span>
              </h3>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
                Live endpoint budgets, 24-hour caps, and anti-spam heuristics
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="p-1.5 text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
              title="Refresh telemetry headers"
            >
              <RefreshCw
                className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-indigo-500' : ''}`}
              />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-neutral-200 dark:border-neutral-800 px-4 sm:px-5 bg-white dark:bg-neutral-900 text-xs font-medium">
          <button
            type="button"
            onClick={() => setActiveTab('status')}
            className={`py-2.5 px-3 border-b-2 cursor-pointer transition-colors flex items-center gap-1.5 ${
              activeTab === 'status'
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 font-semibold'
                : 'border-transparent text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-300'
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            <span>Live Quota &amp; Gauges</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('reference')}
            className={`py-2.5 px-3 border-b-2 cursor-pointer transition-colors flex items-center gap-1.5 ${
              activeTab === 'reference'
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 font-semibold'
                : 'border-transparent text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-300'
            }`}
          >
            <DollarSign className="w-3.5 h-3.5" />
            <span>Official X Rate Limits Reference</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('heuristics')}
            className={`py-2.5 px-3 border-b-2 cursor-pointer transition-colors flex items-center gap-1.5 ${
              activeTab === 'heuristics'
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 font-semibold'
                : 'border-transparent text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-300'
            }`}
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>Anti-Spam &amp; Cooldown Rules</span>
          </button>
        </div>

        {/* Content Body */}
        <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-5">
          {/* TAB 1: Live Status & Gauges */}
          {activeTab === 'status' && (
            <div className="space-y-4">
              {/* Cooldown Alert Banner */}
              {cooldownState?.isThrottled && (
                <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-start justify-between gap-3 text-xs">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <ShieldAlert className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-semibold text-rose-800 dark:text-rose-200">
                        X Account Cooldown Active: {Math.floor(cooldownState.secondsRemaining / 60)}
                        m {cooldownState.secondsRemaining % 60}s remaining
                      </div>
                      <p className="text-neutral-600 dark:text-neutral-400 mt-0.5 leading-relaxed">
                        {cooldownState.reason ||
                          'X placed a temporary write cooldown on automated in-thread replies. Automated drops are paused.'}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleClear}
                    disabled={isClearing}
                    className="px-2.5 py-1 rounded-md bg-rose-600 hover:bg-rose-700 text-white font-medium transition-colors shrink-0 cursor-pointer disabled:opacity-50"
                  >
                    {isClearing ? 'Clearing...' : 'Clear Cooldown'}
                  </button>
                </div>
              )}

              {/* Gauges Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                {/* 15-Minute Window Gauge */}
                <div className="p-4 rounded-xl bg-neutral-50 dark:bg-neutral-800/50 border border-neutral-200 dark:border-neutral-700/80 space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-neutral-600 dark:text-neutral-400 flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-indigo-500" />
                      <span>15-Minute Rolling Window</span>
                    </span>
                    <span className="font-mono text-neutral-500">POST /2/tweets</span>
                  </div>

                  <div>
                    <div className="flex items-baseline justify-between">
                      <span className="text-2xl font-bold font-mono text-neutral-900 dark:text-neutral-100">
                        {remaining}
                      </span>
                      <span className="text-xs font-mono text-neutral-500">/ {limit} requests</span>
                    </div>

                    {/* Progress Bar */}
                    <div className="w-full h-2 bg-neutral-200 dark:bg-neutral-700 rounded-full overflow-hidden mt-1.5">
                      <div
                        className={`h-full transition-all duration-500 ${
                          percentRemaining > 40
                            ? 'bg-emerald-500'
                            : percentRemaining > 15
                              ? 'bg-amber-500'
                              : 'bg-rose-500'
                        }`}
                        style={{ width: `${percentRemaining}%` }}
                      />
                    </div>
                  </div>

                  <div className="pt-2 border-t border-neutral-200/60 dark:border-neutral-700/60 flex items-center justify-between text-[11px] text-neutral-500 font-mono">
                    <span>Window Reset:</span>
                    <span className="font-semibold text-neutral-700 dark:text-neutral-300">
                      {telemetry?.secondsUntilReset
                        ? `${Math.floor(telemetry.secondsUntilReset / 60)}m ${telemetry.secondsUntilReset % 60}s`
                        : 'Active window'}
                    </span>
                  </div>
                </div>

                {/* 24-Hour Rolling Cap Gauge */}
                <div className="p-4 rounded-xl bg-neutral-50 dark:bg-neutral-800/50 border border-neutral-200 dark:border-neutral-700/80 space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-neutral-600 dark:text-neutral-400 flex items-center gap-1.5">
                      <Flame className="w-3.5 h-3.5 text-amber-500" />
                      <span>24-Hour Rolling Volume</span>
                    </span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-neutral-200 dark:bg-neutral-700 text-neutral-700 dark:text-neutral-300">
                      {telemetry?.tierDetected || 'Pay-Per-Use'}
                    </span>
                  </div>

                  <div>
                    <div className="flex items-baseline justify-between">
                      <span className="text-2xl font-bold font-mono text-neutral-900 dark:text-neutral-100">
                        {posts24h}
                      </span>
                      <span className="text-xs font-mono text-neutral-500">
                        / {dailyCap > 1000 ? '10k/day cap' : `${dailyCap}/day cap`}
                      </span>
                    </div>

                    <div className="w-full h-2 bg-neutral-200 dark:bg-neutral-700 rounded-full overflow-hidden mt-1.5">
                      <div
                        className="h-full bg-indigo-500 transition-all duration-500"
                        style={{ width: `${Math.max(2, percentDailyUsed)}%` }}
                      />
                    </div>
                  </div>

                  <div className="pt-2 border-t border-neutral-200/60 dark:border-neutral-700/60 flex items-center justify-between text-[11px] text-neutral-500 font-mono">
                    <span>Est. Cost Today:</span>
                    <span className="font-semibold text-neutral-700 dark:text-neutral-300">
                      ${(posts24h * 0.015).toFixed(3)} USD
                    </span>
                  </div>
                </div>
              </div>

              {/* Active Protection Guardrails */}
              <div className="p-3.5 rounded-xl bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-200/60 dark:border-indigo-800/40 text-xs space-y-2">
                <div className="font-semibold text-indigo-950 dark:text-indigo-200 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                  <span>Integrated Auto-Protection Active:</span>
                </div>
                <ul className="space-y-1 text-neutral-600 dark:text-neutral-400 pl-5 list-disc text-[11px]">
                  <li>
                    <strong className="text-neutral-800 dark:text-neutral-200">
                      Pre-Emptive Rate Window Hold:
                    </strong>{' '}
                    Automated drops hold automatically if remaining calls reach zero until window
                    resets.
                  </li>
                  <li>
                    <strong className="text-neutral-800 dark:text-neutral-200">
                      Anti-Burst Mutex:
                    </strong>{' '}
                    Minimum 60s spacing enforced across all campaigns to prevent burst detection.
                  </li>
                  <li>
                    <strong className="text-neutral-800 dark:text-neutral-200">
                      Quote Tweet Auto-Fallback:
                    </strong>{' '}
                    Optional per campaign (off by default). When on, a reply X refuses with a
                    cooldown or restriction (403) is retried once as a quote tweet.
                  </li>
                </ul>
              </div>
            </div>
          )}

          {/* TAB 2: Official X Rate Limits Reference */}
          {activeTab === 'reference' && (
            <div className="space-y-4 text-xs">
              <p className="text-neutral-600 dark:text-neutral-400 leading-relaxed">
                As of 2024–2026, X API v2 operates on a modernized model with endpoint-specific rate
                limits measured in <strong>15-minute rolling windows</strong> alongside daily
                account volume ceilings.
              </p>

              <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-700">
                <table className="w-full text-left border-collapse text-[11px]">
                  <thead>
                    <tr className="bg-neutral-100 dark:bg-neutral-800 font-semibold text-neutral-700 dark:text-neutral-300 border-b border-neutral-200 dark:border-neutral-700">
                      <th className="p-2.5">X API Tier</th>
                      <th className="p-2.5">15-Min Window (POST /2/tweets)</th>
                      <th className="p-2.5">24-Hour App Cap</th>
                      <th className="p-2.5">Monthly Cap / Pricing</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800 font-mono text-neutral-600 dark:text-neutral-400">
                    <tr className="hover:bg-neutral-50 dark:hover:bg-neutral-800/40">
                      <td className="p-2.5 font-sans font-semibold text-neutral-900 dark:text-neutral-100">
                        Pay-Per-Use (Standard)
                      </td>
                      <td className="p-2.5 text-indigo-600 dark:text-indigo-400 font-semibold">
                        50 requests / 15m
                      </td>
                      <td className="p-2.5">10,000 posts / 24h</td>
                      <td className="p-2.5 font-sans">
                        ~$0.015/tweet (no link), ~$0.20 (with URL)
                      </td>
                    </tr>
                    <tr className="hover:bg-neutral-50 dark:hover:bg-neutral-800/40">
                      <td className="p-2.5 font-sans font-semibold text-neutral-900 dark:text-neutral-100">
                        Free Tier (Legacy)
                      </td>
                      <td className="p-2.5 text-amber-600 dark:text-amber-400 font-semibold">
                        1 request / 15m
                      </td>
                      <td className="p-2.5 text-rose-600 dark:text-rose-400 font-semibold">
                        17 posts / 24h
                      </td>
                      <td className="p-2.5 font-sans">Free (500 writes/month cap)</td>
                    </tr>
                    <tr className="hover:bg-neutral-50 dark:hover:bg-neutral-800/40">
                      <td className="p-2.5 font-sans font-semibold text-neutral-900 dark:text-neutral-100">
                        Basic Tier ($200/mo)
                      </td>
                      <td className="p-2.5">50 requests / 15m</td>
                      <td className="p-2.5">100 posts / 24h per user</td>
                      <td className="p-2.5 font-sans">50,000 writes/mo ($200/mo)</td>
                    </tr>
                    <tr className="hover:bg-neutral-50 dark:hover:bg-neutral-800/40">
                      <td className="p-2.5 font-sans font-semibold text-neutral-900 dark:text-neutral-100">
                        Pro Tier ($5,000/mo)
                      </td>
                      <td className="p-2.5">100 requests / 15m</td>
                      <td className="p-2.5">10,000 posts / 24h</td>
                      <td className="p-2.5 font-sans">300,000 writes/mo ($5,000/mo)</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Global Account-Level Limits */}
              <div className="p-3.5 rounded-xl bg-neutral-50 dark:bg-neutral-800/40 border border-neutral-200 dark:border-neutral-700 space-y-2">
                <div className="font-semibold text-neutral-800 dark:text-neutral-200 flex items-center gap-1.5">
                  <Info className="w-3.5 h-3.5 text-neutral-500" />
                  <span>X Global Account Limits (Across all apps &amp; mobile clients):</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center font-mono text-[11px]">
                  <div className="p-2 rounded-lg bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700">
                    <div className="text-neutral-400 text-[10px]">TWEETS / DAY</div>
                    <div className="font-bold text-neutral-900 dark:text-neutral-100 text-sm mt-0.5">
                      2,400
                    </div>
                  </div>
                  <div className="p-2 rounded-lg bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700">
                    <div className="text-neutral-400 text-[10px]">DIRECT MESSAGES</div>
                    <div className="font-bold text-neutral-900 dark:text-neutral-100 text-sm mt-0.5">
                      500 / day
                    </div>
                  </div>
                  <div className="p-2 rounded-lg bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700">
                    <div className="text-neutral-400 text-[10px]">FOLLOWS / DAY</div>
                    <div className="font-bold text-neutral-900 dark:text-neutral-100 text-sm mt-0.5">
                      400 / day
                    </div>
                  </div>
                  <div className="p-2 rounded-lg bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700">
                    <div className="text-neutral-400 text-[10px]">PROFILE EDITS</div>
                    <div className="font-bold text-neutral-900 dark:text-neutral-100 text-sm mt-0.5">
                      4 / hour
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: Anti-Spam & Heuristics */}
          {activeTab === 'heuristics' && (
            <div className="space-y-3.5 text-xs">
              <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200/80 dark:border-amber-800/40 space-y-2">
                <div className="font-semibold text-amber-900 dark:text-amber-200 flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                  <span>
                    Understanding the 403 &quot;Not permitted to access this feature&quot; Error:
                  </span>
                </div>
                <p className="text-neutral-600 dark:text-neutral-300 leading-relaxed text-[11px]">
                  X enforces automated anti-spam heuristic filters on comments and thread replies.
                  If an automated script drops comments too quickly (e.g. every 1 minute) or
                  cascades multiple comments consecutively on an unverified developer account, X
                  temporarily disables in-thread replying for <strong>15 to 30 minutes</strong>.
                </p>
              </div>

              <div className="space-y-2.5">
                <h4 className="font-semibold text-neutral-800 dark:text-neutral-200">
                  Recommended Best Practices:
                </h4>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div className="p-3 rounded-lg bg-neutral-50 dark:bg-neutral-800/50 border border-neutral-200 dark:border-neutral-700 space-y-1">
                    <div className="font-semibold text-indigo-600 dark:text-indigo-400 flex items-center gap-1">
                      <Quote className="w-3.5 h-3.5" />
                      <span>Use Quote Tweets During Reply Lock</span>
                    </div>
                    <p className="text-[11px] text-neutral-500 dark:text-neutral-400 leading-snug">
                      Quote Tweets are published directly on your profile timeline and are NOT
                      restricted by in-thread comment filters.
                    </p>
                  </div>

                  <div className="p-3 rounded-lg bg-neutral-50 dark:bg-neutral-800/50 border border-neutral-200 dark:border-neutral-700 space-y-1">
                    <div className="font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" />
                      <span>Maintain &ge; 15-Minute Frequency</span>
                    </div>
                    <p className="text-[11px] text-neutral-500 dark:text-neutral-400 leading-snug">
                      Keep automated live drops at 15m, 1h, or fixed 6am/6pm MST clock drops. Use 1m
                      only with Dry-Run mode.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 sm:p-4 border-t border-neutral-200 dark:border-neutral-800 flex items-center justify-between bg-neutral-50/80 dark:bg-neutral-900/80 text-xs">
          <div className="text-[11px] text-neutral-500 font-mono">
            Endpoint:{' '}
            <span className="font-semibold text-neutral-700 dark:text-neutral-300">
              api.x.com/2/tweets
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-neutral-900 dark:bg-neutral-100 hover:bg-neutral-800 dark:hover:bg-neutral-200 text-white dark:text-neutral-900 font-medium transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
