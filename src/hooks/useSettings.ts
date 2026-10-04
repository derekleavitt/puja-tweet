/**
 * X ChromaBot - useSettings
 * Settings mutations (persisted to the server and mirrored to Firestore).
 */

import { saveSettings } from '../api/endpoints.js';
import { saveFirestoreSettings, saveFirestoreContext } from '../lib/firestoreSync.js';
import { BotSettings, QueueSlot } from '../types.js';

interface UseSettingsDeps {
  settings: BotSettings;
  setSettings: (settings: BotSettings) => void;
  setQueue: (queue: QueueSlot[]) => void;
  refresh: () => Promise<void>;
}

export function useSettings({ settings, setSettings, setQueue, refresh }: UseSettingsDeps) {
  // Save settings (persists both in local storage & cloud firestore, and clears/regenerates queue)
  const handleSaveSettings = async (newSettingsPartial: Partial<BotSettings>) => {
    const data = await saveSettings(newSettingsPartial);
    if (data) {
      setSettings(data.settings);
      await saveFirestoreSettings(data.settings);
      if (data.activeContext) {
        await saveFirestoreContext(data.activeContext);
      }
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
  const handleToggleScheduler = () => toggleSetting({ schedulerEnabled: !settings.schedulerEnabled }, 'scheduler');

  // Update Target Tweet ID
  const handleUpdateTargetTweetId = async (newId: string) => {
    await handleSaveSettings({ targetTweetId: newId });
  };

  return { handleSaveSettings, handleToggleDryRun, handleToggleScheduler, handleUpdateTargetTweetId };
}
