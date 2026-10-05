/**
 * X ChromaBot - useSettings
 * Global switches (persisted by the server). Per-campaign fields are edited on the campaign
 * itself (`PUT /api/contexts/:id`), never through the settings view.
 */

import { saveSettings } from '../api/endpoints.js';
import { BotSettings } from '../types.js';

interface UseSettingsDeps {
  settings: BotSettings;
  setSettings: (settings: BotSettings) => void;
  refresh: () => Promise<void>;
}

type GlobalSwitches = Pick<BotSettings, 'globalDryRun' | 'globalPaused'>;

export function useSettings({ settings, setSettings, refresh }: UseSettingsDeps) {
  const saveGlobal = async (partial: GlobalSwitches, label: string) => {
    try {
      const data = await saveSettings(partial);
      if (data?.settings) {
        setSettings(data.settings);
        await refresh();
      }
    } catch (err) {
      console.error(`Error toggling ${label}:`, err);
    }
  };

  // Global dry-run (overrides every campaign); unset means on
  const handleToggleDryRun = () =>
    saveGlobal({ globalDryRun: settings.globalDryRun === false }, 'global dry run');

  // Global pause of all scheduled drops; unset means on
  const handleToggleGlobalPause = () =>
    saveGlobal({ globalPaused: settings.globalPaused === false }, 'global pause');

  return { handleToggleDryRun, handleToggleGlobalPause };
}
