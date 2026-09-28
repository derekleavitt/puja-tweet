/**
 * X ChromaBot - Automated Color Reply Generator
 * Secured behind Google Authentication & synced with Cloud Firestore.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Header } from './components/Header.js';
import { StatusBar } from './components/StatusBar.js';
import { LiveStudio } from './components/LiveStudio.js';
import { QueueViewer } from './components/QueueViewer.js';
import { SettingsPanel } from './components/SettingsPanel.js';
import { HistoryTable } from './components/HistoryTable.js';
import { TwitterSetup } from './components/TwitterSetup.js';
import { StandaloneExport } from './components/StandaloneExport.js';
import { AuthProvider } from './context/AuthContext.js';
import { AuthGate } from './components/AuthGate.js';
import {
  loadFirestoreSettings,
  saveFirestoreSettings,
  recordFirestoreLog,
  loadFirestoreLogs,
} from './lib/firestoreSync.js';
import {
  ColorData,
  BotSettings,
  CredentialsStatus,
  NextPostInfo,
  PostLog,
  QueueSlot,
} from './types.js';

function ChromaBotDashboard() {
  const [activeTab, setActiveTab] = useState<string>('studio');
  const [color, setColor] = useState<ColorData | null>(null);
  const [settings, setSettings] = useState<BotSettings>({
    targetTweetId: '2091597504928428416',
    scheduleTimes: ['06:00', '18:00'],
    timezone: 'America/Los_Angeles',
    schedulerEnabled: true,
    dryRun: false,
    template: '',
    themePreference: 'dynamic',
  });
  const [nextPost, setNextPost] = useState<NextPostInfo | null>(null);
  const [credentialsStatus, setCredentialsStatus] = useState<CredentialsStatus | null>(null);
  const [queue, setQueue] = useState<QueueSlot[]>([]);
  const [logs, setLogs] = useState<PostLog[]>([]);
  const [isPosting, setIsPosting] = useState<boolean>(false);
  const [lastPostedResult, setLastPostedResult] = useState<any>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Fetch status & state from backend & Firestore
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/status');
      if (res.ok) {
        const data = await res.json();
        setSettings(data.settings);
        setNextPost(data.nextPost);
        setCredentialsStatus(data.credentialsStatus);
      }
    } catch (err) {
      console.error('Error fetching bot status:', err);
    }
  }, []);

  const fetchQueue = useCallback(async () => {
    try {
      const res = await fetch('/api/queue');
      if (res.ok) {
        const data = await res.json();
        setQueue(data.queue);
      }
    } catch (err) {
      console.error('Error fetching queue:', err);
    }
  }, []);

  const fetchHistory = useCallback(async () => {
    try {
      // 1. Fetch server logs
      const res = await fetch('/api/history');
      let combinedLogs: PostLog[] = [];
      if (res.ok) {
        const data = await res.json();
        combinedLogs = data.logs || [];
      }

      // 2. Fetch firestore logs if present
      const cloudLogs = await loadFirestoreLogs();
      if (cloudLogs && cloudLogs.length > 0) {
        const idSet = new Set(combinedLogs.map(l => l.id));
        cloudLogs.forEach(cl => {
          if (!idSet.has(cl.id)) {
            combinedLogs.push(cl);
          }
        });
        combinedLogs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      }

      setLogs(combinedLogs);
    } catch (err) {
      console.error('Error fetching logs:', err);
    }
  }, []);

  const generateColor = useCallback(async (slotType: 'morning' | 'evening' | 'random' = 'morning') => {
    try {
      const res = await fetch('/api/generate-color', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slotType }),
      });
      if (res.ok) {
        const data = await res.json();
        setColor(data.color);
      }
    } catch (err) {
      console.error('Error generating color:', err);
    }
  }, []);

  // Initial load: check Firestore for saved cloud settings
  useEffect(() => {
    async function init() {
      setIsLoading(true);

      // Check Firestore cloud settings first
      try {
        const cloudSettings = await loadFirestoreSettings();
        if (cloudSettings && cloudSettings.targetTweetId) {
          setSettings(cloudSettings);
          // Sync server memory with cloud settings
          await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(cloudSettings),
          });
        }
      } catch (e) {
        console.warn('Initial cloud sync error:', e);
      }

      await Promise.all([fetchStatus(), fetchQueue(), fetchHistory(), generateColor('morning')]);
      setIsLoading(false);
    }
    init();

    // Heartbeat poll every 8 seconds
    const interval = setInterval(() => {
      fetchStatus();
    }, 8000);

    return () => clearInterval(interval);
  }, [fetchStatus, fetchQueue, fetchHistory, generateColor]);

  // Handle post now
  const handlePostNow = async (
    customColor?: ColorData,
    slotType: 'morning' | 'evening' | 'manual' = 'manual'
  ) => {
    setIsPosting(true);
    setLastPostedResult(null);

    try {
      const targetColor = customColor || color;
      const res = await fetch('/api/post-now', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slotType,
          color: targetColor,
        }),
      });

      const data = await res.json();
      setLastPostedResult(data);

      if (data.log) {
        // Sync log to Cloud Firestore
        await recordFirestoreLog(data.log);
      }

      await Promise.all([fetchStatus(), fetchHistory(), fetchQueue()]);
      return data;
    } catch (err: any) {
      const errObj = { success: false, error: err.message };
      setLastPostedResult(errObj);
      return errObj;
    } finally {
      setIsPosting(false);
    }
  };

  // Toggle dry run
  const handleToggleDryRun = async () => {
    const updated = !settings.dryRun;
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: updated }),
      });
      if (res.ok) {
        const newSettings = { ...settings, dryRun: updated };
        setSettings(newSettings);
        await saveFirestoreSettings(newSettings);
      }
    } catch (err) {
      console.error('Error toggling dry run:', err);
    }
  };

  // Toggle scheduler active/paused
  const handleToggleScheduler = async () => {
    const updated = !settings.schedulerEnabled;
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schedulerEnabled: updated }),
      });
      if (res.ok) {
        const newSettings = { ...settings, schedulerEnabled: updated };
        setSettings(newSettings);
        await saveFirestoreSettings(newSettings);
      }
    } catch (err) {
      console.error('Error toggling scheduler:', err);
    }
  };

  // Save settings (persists both in local storage & cloud firestore)
  const handleSaveSettings = async (newSettingsPartial: Partial<BotSettings>) => {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newSettingsPartial),
    });
    if (res.ok) {
      const data = await res.json();
      setSettings(data.settings);
      // Persist to Cloud Firestore
      await saveFirestoreSettings(data.settings);
      fetchStatus();
    }
  };

  // Reroll queue slot
  const handleRerollSlot = async (slotId: string) => {
    try {
      const res = await fetch('/api/queue/reroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slotId }),
      });
      if (res.ok) {
        await fetchQueue();
      }
    } catch (err) {
      console.error('Error rerolling slot:', err);
    }
  };

  // Save credentials
  const handleSaveCredentials = async (creds: any) => {
    const res = await fetch('/api/credentials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(creds),
    });
    if (res.ok) {
      const data = await res.json();
      setCredentialsStatus(data.credentialsStatus);
      fetchStatus();
    }
  };

  // Verify credentials
  const handleVerifyCredentials = async () => {
    const res = await fetch('/api/twitter/verify', { method: 'POST' });
    return await res.json();
  };

  // Clear history
  const handleClearHistory = async () => {
    const res = await fetch('/api/history', { method: 'DELETE' });
    if (res.ok) {
      setLogs([]);
    }
  };

  // Update Target Tweet ID
  const handleUpdateTargetTweetId = async (newId: string) => {
    await handleSaveSettings({ targetTweetId: newId });
  };

  return (
    <div className="min-h-screen bg-neutral-100/60 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 flex flex-col font-sans antialiased">
      {/* Top Bar with 3-Zone Contract */}
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onQuickPost={() => handlePostNow(color || undefined, 'manual')}
        isPosting={isPosting}
        dryRun={settings.dryRun}
        onToggleDryRun={handleToggleDryRun}
        targetTweetId={settings.targetTweetId}
        onUpdateTargetTweetId={handleUpdateTargetTweetId}
      />

      {/* Status Bar with live countdown and unboxed metadata */}
      <StatusBar
        nextPost={nextPost}
        credentialsStatus={credentialsStatus}
        targetTweetId={settings.targetTweetId}
        schedulerEnabled={settings.schedulerEnabled}
        onToggleScheduler={handleToggleScheduler}
        timezone={settings.timezone}
        scheduleTimes={settings.scheduleTimes}
      />

      {/* Main Container Viewport */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 md:p-8">
        {isLoading ? (
          <div className="py-24 text-center text-neutral-500">
            <div className="w-8 h-8 mx-auto mb-3 rounded-full border-2 border-neutral-300 border-t-neutral-800 dark:border-neutral-700 dark:border-t-neutral-200 animate-spin" />
            <p className="text-sm font-medium">Connecting to Cloud Firestore &amp; Scheduler...</p>
          </div>
        ) : (
          <>
            {activeTab === 'studio' && (
              <LiveStudio
                color={color}
                onGenerateColor={generateColor}
                onPostNow={handlePostNow}
                settings={settings}
                isPosting={isPosting}
                lastPostedResult={lastPostedResult}
                onUpdateTargetTweetId={handleUpdateTargetTweetId}
              />
            )}

            {activeTab === 'queue' && (
              <QueueViewer
                queue={queue}
                onRerollSlot={handleRerollSlot}
                onPostNow={(slotColor, slotType) => handlePostNow(slotColor, slotType)}
                isPosting={isPosting}
              />
            )}

            {activeTab === 'history' && (
              <HistoryTable logs={logs} onClearHistory={handleClearHistory} />
            )}

            {activeTab === 'settings' && (
              <SettingsPanel settings={settings} onSaveSettings={handleSaveSettings} />
            )}

            {activeTab === 'credentials' && (
              <TwitterSetup
                credentialsStatus={credentialsStatus}
                onSaveCredentials={handleSaveCredentials}
                onVerifyCredentials={handleVerifyCredentials}
              />
            )}

            {activeTab === 'export' && <StandaloneExport settings={settings} />}
          </>
        )}
      </main>

      {/* Clean Unboxed Footer */}
      <footer className="border-t border-neutral-200 dark:border-neutral-800 py-6 px-6 text-xs text-neutral-500 bg-white dark:bg-neutral-950">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-neutral-700 dark:text-neutral-300">X ChromaBot</span>
            <span>·</span>
            <span>Target: x.com/pfinallyhere/status/{settings.targetTweetId}</span>
          </div>
          <div className="flex items-center gap-4 text-neutral-400 font-mono text-[11px]">
            <span>Cloud State &amp; Google Auth Active</span>
            <span>·</span>
            <span>RFC 5849 OAuth 1.0a &amp; X API v2</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AuthGate>
        <ChromaBotDashboard />
      </AuthGate>
    </AuthProvider>
  );
}
