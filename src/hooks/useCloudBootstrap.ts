/**
 * X ChromaBot - useCloudBootstrap
 * One-time startup: restore cloud contexts/settings from Firestore into the
 * server, then load the initial dashboard data.
 */

import { useEffect, useRef, useState } from 'react';
import { activateContext, saveSettings, syncContext } from '../api/endpoints.js';
import {
  loadFirestoreSettings,
  loadFirestoreContexts,
  saveFirestoreContext,
} from '../lib/firestoreSync.js';
import { BotSettings } from '../types.js';

interface UseCloudBootstrapDeps {
  setSettings: (settings: BotSettings) => void;
  loadInitialData: () => Promise<unknown>;
}

export function useCloudBootstrap({ setSettings, loadInitialData }: UseCloudBootstrapDeps) {
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const hasInitializedRef = useRef<boolean>(false);
  const loadRef = useRef(loadInitialData);
  loadRef.current = loadInitialData;

  // Runs once on mount
  useEffect(() => {
    async function init() {
      if (hasInitializedRef.current) return;
      hasInitializedRef.current = true;
      setIsLoading(true);

      try {
        // Load cloud contexts if saved
        const cloudContexts = await loadFirestoreContexts();
        if (cloudContexts && cloudContexts.length > 0) {
          // Sync server with cloud contexts (preserving each campaign's independent schedule)
          for (const c of cloudContexts) {
            const putJson = await syncContext(c);
            if (putJson?.context) {
              await saveFirestoreContext(putJson.context);
            }
          }

          // Restore activeContextId from cloudSettings without overwriting campaign schedules
          const cloudSettings = await loadFirestoreSettings();
          if (cloudSettings?.activeContextId && cloudContexts.some(c => c.id === cloudSettings.activeContextId)) {
            await activateContext(cloudSettings.activeContextId);
          }
        } else {
          const cloudSettings = await loadFirestoreSettings();
          if (cloudSettings && cloudSettings.targetTweetId) {
            setSettings(cloudSettings);
            await saveSettings(cloudSettings);
          }
        }
      } catch (e) {
        console.warn('Initial cloud sync error:', e);
      }

      await loadRef.current();
      setIsLoading(false);
    }
    init();
  }, [setSettings]);

  return { isLoading };
}
