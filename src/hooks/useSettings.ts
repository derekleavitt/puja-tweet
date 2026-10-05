/**
 * X ChromaBot - useSettings
 * Settings mutations (persisted by the server).
 */

import { saveSettings } from '../api/endpoints.js';
import { BotSettings, QueueSlot } from '../types.js';

/** A settings save always names the campaign it edits (the one the caller rendered). */
export type SettingsSave = Partial<BotSettings> & { contextId?: string };

interface UseSettingsDeps {
  settings: BotSettings;
  setSettings: (settings: BotSettings) => void;
  setQueue: (queue: QueueSlot[]) => void;
  refresh: () => Promise<void>;
}

export function useSettings({ settings, setSettings, setQueue, refresh }: UseSettingsDeps) {
  // Save settings (persisted by the server, which also clears/regenerates queue).
  // Campaign fields go to the campaign the caller saw (`contextId`), never "whatever is active now".
  const handleSaveSettings = async (newSettingsPartial: SettingsSave) => {
    const data = await saveSettings({
      contextId: settings.activeContextId,
      ...newSettingsPartial,
    });
    if (data?.settings) {
      setSettings(data.settings);
      if (Array.isArray(data.queue)) {
        setQueue(data.queue);
      }
      await refresh();
    }
  };

  const toggleSetting = async (partial: Partial<BotSettings>, label: string) => {
    try {
      await handleSaveSettings(partial);
    } catch (err) {
      console.error(`Error toggling ${label}:`, err);
    }
  };

  // Global dry-run (overrides every campaign); unset means on
  const handleToggleDryRun = () =>
    toggleSetting({ globalDryRun: settings.globalDryRun === false }, 'global dry run');

  // Global pause of all scheduled drops; unset means on
  const handleToggleGlobalPause = () =>
    toggleSetting({ globalPaused: settings.globalPaused === false }, 'global pause');

  // Update Target Tweet ID
  const handleUpdateTargetTweetId = async (newId: string) => {
    await handleSaveSettings({ targetTweetId: newId });
  };

  return {
    handleSaveSettings,
    handleToggleDryRun,
    handleToggleGlobalPause,
    handleUpdateTargetTweetId,
  };
}
