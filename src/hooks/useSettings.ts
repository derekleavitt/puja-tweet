/**
 * X ChromaBot - useSettings
 * Settings mutations (persisted by the server).
 */

import { saveSettings } from '../api/endpoints.js';
import { BotSettings, QueueSlot } from '../types.js';

interface UseSettingsDeps {
  settings: BotSettings;
  setSettings: (settings: BotSettings) => void;
  setQueue: (queue: QueueSlot[]) => void;
  refresh: () => Promise<void>;
}

export function useSettings({ settings, setSettings, setQueue, refresh }: UseSettingsDeps) {
  // Save settings (persisted by the server, which also clears/regenerates queue)
  const handleSaveSettings = async (newSettingsPartial: Partial<BotSettings>) => {
    const data = await saveSettings(newSettingsPartial);
    if (data) {
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

  // Toggle dry run
  const handleToggleDryRun = () => toggleSetting({ dryRun: !settings.dryRun }, 'dry run');

  // Toggle scheduler active/paused
  const handleToggleScheduler = () =>
    toggleSetting({ schedulerEnabled: !settings.schedulerEnabled }, 'scheduler');

  // Update Target Tweet ID
  const handleUpdateTargetTweetId = async (newId: string) => {
    await handleSaveSettings({ targetTweetId: newId });
  };

  return {
    handleSaveSettings,
    handleToggleDryRun,
    handleToggleScheduler,
    handleUpdateTargetTweetId,
  };
}
