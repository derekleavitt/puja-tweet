/**
 * X ChromaBot - SettingsPanel
 * Timing & autonomous reply settings form. Saves only the fields that changed.
 */

import React, { useState } from 'react';
import { Save, Check, RefreshCw } from 'lucide-react';
import { BotSettings } from '../../types.js';
import { extractTweetId } from '../../../shared/tweetId.js';
import { useServerInfo } from '../../context/serverInfo.js';
import { TemplateEditor } from '../../components/TemplateEditor.js';
import { TargetSettings } from './TargetSettings.js';
import { ScheduleSettings, ScheduleValues } from './ScheduleSettings.js';
import { WebhookSettings } from './WebhookSettings.js';
import { RunToggles } from './RunToggles.js';

interface SettingsPanelProps {
  settings: BotSettings;
  onSaveSettings: (newSettings: Partial<BotSettings>) => Promise<void>;
  campaignName?: string;
  onToggleGlobalDryRun: () => void;
  onToggleGlobalPause: () => void;
}

const CARD =
  'border border-neutral-200 dark:border-neutral-800 rounded-xl p-5 bg-white dark:bg-neutral-900 shadow-xs';
const TIME_PATTERN = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;

/**
 * Keyed by the active campaign so the form fully remounts (and resyncs) when
 * the active campaign changes.
 */
export const SettingsPanel: React.FC<SettingsPanelProps> = (props) => (
  <SettingsForm key={props.settings.activeContextId ?? 'default'} {...props} />
);

const SettingsForm: React.FC<SettingsPanelProps> = ({
  settings,
  onSaveSettings,
  campaignName,
  onToggleGlobalDryRun,
  onToggleGlobalPause,
}) => {
  const { defaultTargetTweetId } = useServerInfo();
  // An unset target starts from the server default (never a client constant).
  const [targetTweetId, setTargetTweetId] = useState(
    settings.targetTweetId || defaultTargetTweetId,
  );
  const [replyTargetMode, setReplyTargetMode] = useState<'original_post' | 'last_comment'>(
    settings.replyTargetMode || 'original_post',
  );
  // The chain anchor is server-owned; the form only tracks an explicit "Reset to Root" click.
  const [anchorReset, setAnchorReset] = useState(false);
  const lastPostedTweetId = anchorReset ? undefined : settings.lastPostedTweetId;
  const [schedule, setSchedule] = useState<ScheduleValues>({
    intervalMode: settings.intervalMode || 'interval',
    intervalMinutes: settings.intervalMinutes || 720,
    scheduleTimes: settings.scheduleTimes.join(', '),
    timezone: settings.timezone,
    humanizeJitterEnabled: settings.humanizeJitterEnabled ?? true,
    jitterPercentage: settings.jitterPercentage ?? 25,
  });
  const [toggles, setToggles] = useState({
    schedulerEnabled: settings.schedulerEnabled,
    dryRun: settings.dryRun,
  });
  const [template, setTemplate] = useState(settings.template);
  const [isSaving, setIsSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  const flashSaved = (ms: number) => {
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), ms);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const times = schedule.scheduleTimes
        .split(',')
        .map((t) => t.trim())
        .filter((t) => TIME_PATTERN.test(t));

      const next: Partial<BotSettings> = {
        targetTweetId: extractTweetId(targetTweetId) || targetTweetId.trim(),
        replyTargetMode,
        intervalMode: schedule.intervalMode,
        intervalMinutes: Number(schedule.intervalMinutes),
        scheduleTimes: times.length > 0 ? times : ['06:00', '18:00'],
        timezone: schedule.timezone,
        schedulerEnabled: toggles.schedulerEnabled,
        dryRun: toggles.dryRun,
        template,
        humanizeJitterEnabled: schedule.humanizeJitterEnabled,
        jitterPercentage: Number(schedule.jitterPercentage),
      };
      // Send only changed fields; never send the chain anchor unless explicitly reset.
      const changed: Record<string, unknown> = {};
      for (const key of Object.keys(next) as (keyof BotSettings)[]) {
        if (JSON.stringify(next[key]) !== JSON.stringify(settings[key])) {
          changed[key] = next[key];
        }
      }
      if (anchorReset) changed.lastPostedTweetId = null;

      if (Object.keys(changed).length > 0) {
        await onSaveSettings(changed as Partial<BotSettings>);
      }
      setAnchorReset(false);
      flashSaved(2500);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="max-w-4xl space-y-6">
      <div className="pb-4 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
            Timing & Autonomous Reply Settings
          </h2>
          <p className="text-sm text-neutral-500 mt-0.5">
            Configure how often ChromaBot posts: by interval (1m, 15m, 1h, 3h, 6h, 12h) or at fixed
            clock times.
          </p>
        </div>

        {savedSuccess && (
          <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1.5 bg-emerald-50 dark:bg-emerald-950/40 px-3 py-1 rounded-md border border-emerald-200 dark:border-emerald-800">
            <Check className="w-3.5 h-3.5" /> Settings Saved
          </span>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <TargetSettings
          targetTweetId={targetTweetId}
          onTargetChange={setTargetTweetId}
          replyTargetMode={replyTargetMode}
          onModeChange={setReplyTargetMode}
          lastPostedTweetId={lastPostedTweetId}
          onResetAnchor={() => setAnchorReset(true)}
        />
        <ScheduleSettings
          value={schedule}
          onChange={(patch) => setSchedule((prev) => ({ ...prev, ...patch }))}
        />
        <WebhookSettings onCopied={() => flashSaved(2000)} />
        <RunToggles
          {...toggles}
          campaignName={campaignName}
          globalDryRun={settings.globalDryRun !== false}
          globalPaused={settings.globalPaused !== false}
          onToggleGlobalDryRun={onToggleGlobalDryRun}
          onToggleGlobalPause={onToggleGlobalPause}
          onChange={(patch) => setToggles((prev) => ({ ...prev, ...patch }))}
        />

        <div className={CARD}>
          <TemplateEditor template={template} onChange={setTemplate} required />
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="submit"
            disabled={isSaving}
            className="px-5 py-2 text-sm font-semibold text-white bg-neutral-900 hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200 rounded-lg transition-colors flex items-center gap-2 cursor-pointer shadow-xs disabled:opacity-50"
          >
            {isSaving ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            Save Settings
          </button>
        </div>
      </form>
    </div>
  );
};
