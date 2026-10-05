/**
 * X ChromaBot - SettingsPanel
 * GLOBAL settings only: dry run / pause for every campaign, the webhook secret, and rate limits /
 * cooldown. Everything that belongs to one campaign is configured on its card (Campaigns screen).
 */

import React, { useState } from 'react';
import { Check, Activity } from 'lucide-react';
import { BotSettings, CooldownState, RateLimitTelemetry, TweetContext } from '../../types.js';
import { AccountsPanel } from './AccountsPanel.js';
import { useServerInfo } from '../../context/serverInfo.js';
import { accountName, findAccount } from '../../lib/accounts.js';
import { WebhookSettings } from './WebhookSettings.js';
import { RunToggles } from './RunToggles.js';

interface SettingsPanelProps {
  settings: BotSettings;
  contexts: TweetContext[];
  refresh: () => Promise<void> | void;
  /** X cooldown per account id. */
  accountCooldowns?: Record<string, CooldownState>;
  onToggleGlobalDryRun: () => void;
  onToggleGlobalPause: () => void;
  cooldownState?: CooldownState | null;
  rateLimitTelemetry?: RateLimitTelemetry | null;
  onOpenRateLimits: () => void;
  onClearCooldown: () => void;
}

const BUTTON =
  'px-3 py-1.5 text-xs font-semibold bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-neutral-800 dark:text-neutral-200 rounded-lg transition-colors cursor-pointer';

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  settings,
  contexts,
  refresh,
  accountCooldowns = {},
  onToggleGlobalDryRun,
  onToggleGlobalPause,
  cooldownState,
  rateLimitTelemetry,
  onOpenRateLimits,
  onClearCooldown,
}) => {
  const [copied, setCopied] = useState(false);
  const { accounts } = useServerInfo();
  const throttled = Object.entries(accountCooldowns)
    .filter(([, c]) => c.isThrottled)
    .map(
      ([id, c]) =>
        `${accountName(findAccount(accounts, id), id)} ${Math.ceil(c.secondsRemaining / 60)}m`,
    );
  const anyThrottled = throttled.length > 0 || !!cooldownState?.isThrottled;
  const flashCopied = () => {
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="max-w-4xl space-y-6">
      <div className="pb-4 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
            Global Settings
          </h2>
          <p className="text-sm text-neutral-500 mt-0.5">
            Switches that apply to every campaign. Targets, schedules, templates and per-campaign
            dry run are edited on each campaign card.
          </p>
        </div>

        {copied && (
          <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1.5 bg-emerald-50 dark:bg-emerald-950/40 px-3 py-1 rounded-md border border-emerald-200 dark:border-emerald-800">
            <Check className="w-3.5 h-3.5" /> Copied
          </span>
        )}
      </div>

      <RunToggles
        globalDryRun={settings.globalDryRun !== false}
        globalPaused={settings.globalPaused !== false}
        onToggleGlobalDryRun={onToggleGlobalDryRun}
        onToggleGlobalPause={onToggleGlobalPause}
      />

      <section
        aria-label="Rate limits"
        className="border border-neutral-200 dark:border-neutral-800 rounded-xl p-5 bg-white dark:bg-neutral-900 space-y-3 shadow-xs"
      >
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <span className="text-xs font-bold uppercase tracking-wider text-neutral-700 dark:text-neutral-300 flex items-center gap-2">
            <Activity className="w-4 h-4 text-indigo-500" />
            Rate limits &amp; cooldown
          </span>
          <div className="flex items-center gap-2">
            {anyThrottled && (
              <button type="button" onClick={onClearCooldown} className={BUTTON}>
                Clear cooldown
              </button>
            )}
            <button type="button" onClick={onOpenRateLimits} className={BUTTON}>
              Open rate limits
            </button>
          </div>
        </div>
        <p className="text-xs text-neutral-500">
          {anyThrottled
            ? `Cooldown active (${throttled.join(', ') || `${Math.ceil((cooldownState?.secondsRemaining ?? 0) / 60)}m`}): campaigns posting as ${throttled.length === 1 ? 'that account' : 'those accounts'} wait until it ends.`
            : `X quota: ${rateLimitTelemetry?.remaining ?? '?'} / ${rateLimitTelemetry?.limit ?? '?'} remaining. The anti-spam spacing and cooldown apply per X account.`}
        </p>
      </section>

      <AccountsPanel contexts={contexts} refresh={refresh} />

      <WebhookSettings onCopied={flashCopied} />
    </div>
  );
};
