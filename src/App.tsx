/**
 * X ChromaBot - Automated Color Reply Generator
 * Multi-Context Autonomous Architecture
 * Secured behind Google Authentication & synced with Cloud Firestore.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Header } from './components/Header.js';
import { StatusBar } from './components/StatusBar.js';
import { LiveStudio } from './components/LiveStudio.js';
import { ContextsManager } from './components/ContextsManager.js';
import { QueueViewer } from './components/QueueViewer.js';
import { SettingsPanel } from './components/SettingsPanel.js';
import { HistoryTable } from './components/HistoryTable.js';
import { TwitterSetup } from './components/TwitterSetup.js';
import { StandaloneExport } from './components/StandaloneExport.js';
import { RateLimitModal } from './components/RateLimitModal.js';
import { AuthProvider } from './context/AuthContext.js';
import { AuthGate } from './components/AuthGate.js';
import {
  loadFirestoreSettings,
  saveFirestoreSettings,
  recordFirestoreLog,
  loadFirestoreLogs,
  loadFirestoreContexts,
  saveFirestoreContext,
  deleteFirestoreContext,
} from './lib/firestoreSync.js';
import {
  ColorData,
  BotSettings,
  CredentialsStatus,
  NextPostInfo,
  PostLog,
  QueueSlot,
  TweetContext,
  CooldownState,
  RateLimitTelemetry,
} from './types.js';
import { ShieldAlert, Clock, RefreshCw } from 'lucide-react';

function ChromaBotDashboard() {
  const [activeTab, setActiveTab] = useState<string>('studio');
  const [color, setColor] = useState<ColorData | null>(null);
  const [settings, setSettings] = useState<BotSettings>({
    targetTweetId: '2091597504928428416',
    scheduleTimes: ['06:00', '18:00'],
    timezone: 'America/Denver',
    schedulerEnabled: true,
    dryRun: false,
    template: '{color_pick} {weather_desc} #eternal #colors',
    themePreference: 'dynamic',
    intervalMode: 'interval',
    intervalMinutes: 15,
  });
  const [contexts, setContexts] = useState<TweetContext[]>([]);
  const [activeContextId, setActiveContextId] = useState<string>('ctx_primary');
  const [nextPost, setNextPost] = useState<NextPostInfo | null>(null);
  const [allNextPosts, setAllNextPosts] = useState<any[]>([]);
  const [credentialsStatus, setCredentialsStatus] = useState<CredentialsStatus | null>(null);
  const [cooldownState, setCooldownState] = useState<CooldownState | null>(null);
  const [rateLimitTelemetry, setRateLimitTelemetry] = useState<RateLimitTelemetry | null>(null);
  const [isRateLimitModalOpen, setIsRateLimitModalOpen] = useState<boolean>(false);
  const [queue, setQueue] = useState<QueueSlot[]>([]);
  const [logs, setLogs] = useState<PostLog[]>([]);
  const [isPosting, setIsPosting] = useState<boolean>(false);
  const [lastPostedResult, setLastPostedResult] = useState<any>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const hasInitializedRef = useRef<boolean>(false);

  // Fetch status & state from backend & Firestore
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/status');
      if (res.ok) {
        const data = await res.json();
        setSettings(data.settings);
        if (data.contexts && data.contexts.length > 0) {
          setContexts(data.contexts);
        }
        if (data.activeContext?.id) {
          setActiveContextId(data.activeContext.id);
        }
        setNextPost(data.nextPost);
        if (data.allNextPosts) {
          setAllNextPosts(data.allNextPosts);
        }
        setCredentialsStatus(data.credentialsStatus);
        if (data.cooldownState) {
          setCooldownState(data.cooldownState);
        }
        if (data.rateLimitTelemetry) {
          setRateLimitTelemetry(data.rateLimitTelemetry);
        }
        if (Array.isArray(data.queue)) {
          setQueue(data.queue);
        }
      }
    } catch (err) {
      console.error('Error fetching bot status:', err);
    }
  }, []);

  const handleRefreshRateLimits = async () => {
    try {
      const res = await fetch('/api/rate-limits');
      if (res.ok) {
        const data = await res.json();
        if (data.telemetry) setRateLimitTelemetry(data.telemetry);
        if (data.cooldownState) setCooldownState(data.cooldownState);
      }
    } catch (e) {
      console.error('Failed to refresh rate limits:', e);
    }
  };

  const handleClearCooldown = async () => {
    try {
      const res = await fetch('/api/cooldown/clear', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setCooldownState(data.cooldownState);
        await handleRefreshRateLimits();
      }
    } catch (e) {
      console.error('Failed to clear cooldown:', e);
    }
  };

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
        body: JSON.stringify({ slotType, contextId: activeContextId }),
      });
      if (res.ok) {
        const data = await res.json();
        setColor(data.color);
      }
    } catch (err) {
      console.error('Error generating color:', err);
    }
  }, [activeContextId]);

  // Initial load: check Firestore for saved cloud contexts & settings (runs once on mount)
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
            const putRes = await fetch(`/api/contexts/${c.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(c),
            });
            if (putRes.ok) {
              const putJson = await putRes.json();
              if (putJson.context) {
                await saveFirestoreContext(putJson.context);
              }
            }
          }

          // Restore activeContextId from cloudSettings without overwriting campaign schedules
          const cloudSettings = await loadFirestoreSettings();
          if (cloudSettings?.activeContextId && cloudContexts.some(c => c.id === cloudSettings.activeContextId)) {
            await fetch(`/api/contexts/${cloudSettings.activeContextId}/activate`, { method: 'POST' });
          }
        } else {
          const cloudSettings = await loadFirestoreSettings();
          if (cloudSettings && cloudSettings.targetTweetId) {
            setSettings(cloudSettings);
            await fetch('/api/settings', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(cloudSettings),
            });
          }
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
      fetchHistory();
      fetchQueue();
    }, 8000);

    return () => clearInterval(interval);
  }, [fetchStatus, fetchQueue, fetchHistory, generateColor]);

  // Handle post now (manual trigger)
  const handlePostNow = async (
    customColor?: ColorData,
    slotType: 'morning' | 'evening' | 'manual' = 'manual',
    contextId?: string
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
          contextId: contextId || activeContextId,
        }),
      });

      const data = await res.json();
      setLastPostedResult(data);

      if (data.log) {
        await recordFirestoreLog(data.log);
        setLogs(prev => [data.log, ...prev]);
      }
      if (data.context) {
        await saveFirestoreContext(data.context);
      }

      await fetchStatus();
      await fetchQueue();
      return data;
    } catch (err: any) {
      console.error('Error posting now:', err);
      const errObj = { success: false, error: err.message };
      setLastPostedResult(errObj);
      return errObj;
    } finally {
      setIsPosting(false);
    }
  };

  // Context Management Handlers
  const handleSelectActiveContext = async (id: string) => {
    try {
      const res = await fetch(`/api/contexts/${id}/activate`, { method: 'POST' });
      if (res.ok) {
        const json = await res.json();
        setActiveContextId(id);
        if (Array.isArray(json.queue)) {
          setQueue(json.queue);
        }
        await fetchStatus();
        await fetchQueue();
        await generateColor('morning');
      }
    } catch (err) {
      console.error('Error switching active context:', err);
    }
  };

  const handleCreateContext = async (data: Partial<TweetContext>) => {
    const res = await fetch('/api/contexts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (res.ok) {
      const json = await res.json();
      if (json.context) {
        await saveFirestoreContext(json.context);
      }
      if (Array.isArray(json.queue)) {
        setQueue(json.queue);
      }
      await fetchStatus();
      await fetchQueue();
    } else {
      const err = await res.json();
      throw new Error(err.error || 'Failed to create context');
    }
  };

  const handleUpdateContext = async (id: string, updates: Partial<TweetContext>) => {
    const res = await fetch(`/api/contexts/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (res.ok) {
      const json = await res.json();
      if (json.context) {
        await saveFirestoreContext(json.context);
      }
      if (Array.isArray(json.queue)) {
        setQueue(json.queue);
      }
      await fetchStatus();
      await fetchQueue();
    } else {
      const err = await res.json();
      throw new Error(err.error || 'Failed to update context');
    }
  };

  const handleDeleteContext = async (id: string) => {
    const res = await fetch(`/api/contexts/${id}`, { method: 'DELETE' });
    if (res.ok) {
      const json = await res.json();
      await deleteFirestoreContext(id);
      if (Array.isArray(json.queue)) {
        setQueue(json.queue);
      }
      await fetchStatus();
      await fetchQueue();
    } else {
      const err = await res.json();
      throw new Error(err.error || 'Failed to delete context');
    }
  };

  const handleDuplicateContext = async (id: string) => {
    const res = await fetch(`/api/contexts/${id}/duplicate`, { method: 'POST' });
    if (res.ok) {
      const json = await res.json();
      if (json.context) {
        await saveFirestoreContext(json.context);
      }
      if (Array.isArray(json.queue)) {
        setQueue(json.queue);
      }
      await fetchStatus();
      await fetchQueue();
    }
  };

  const handleToggleContext = async (id: string) => {
    const res = await fetch(`/api/contexts/${id}/toggle`, { method: 'POST' });
    if (res.ok) {
      const json = await res.json();
      if (json.context) {
        await saveFirestoreContext(json.context);
      }
      if (Array.isArray(json.queue)) {
        setQueue(json.queue);
      }
      await fetchStatus();
      await fetchQueue();
    }
  };

  const handleTriggerContext = async (id: string) => {
    const res = await fetch(`/api/contexts/${id}/trigger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slotType: 'manual' }),
    });
    const data = await res.json();
    if (data.log) {
      await recordFirestoreLog(data.log);
      setLogs(prev => [data.log, ...prev]);
    }
    if (data.context) {
      await saveFirestoreContext(data.context);
    }
    await fetchStatus();
    await fetchQueue();
    return data;
  };

  const handleClearContextHistory = async (id: string) => {
    try {
      const res = await fetch(`/api/contexts/${id}/clear-history`, {
        method: 'POST',
      });
      if (res.ok) {
        const json = await res.json();
        if (json.context) {
          await saveFirestoreContext(json.context);
        }
        if (Array.isArray(json.queue)) {
          setQueue(json.queue);
        }
        setLogs(prev => prev.filter(l => (id === 'ctx_primary' ? l.contextId && l.contextId !== 'ctx_primary' : l.contextId !== id)));
        await fetchHistory();
        await fetchStatus();
        await fetchQueue();
      } else {
        const err = await res.json();
        throw new Error(err.error || 'Failed to clear campaign history');
      }
    } catch (err: any) {
      console.error('Error clearing context history:', err);
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
        const data = await res.json();
        setSettings(data.settings);
        await saveFirestoreSettings(data.settings);
        if (data.activeContext) {
          await saveFirestoreContext(data.activeContext);
        }
        if (Array.isArray(data.queue)) {
          setQueue(data.queue);
        }
        await fetchStatus();
        await fetchQueue();
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
        const data = await res.json();
        setSettings(data.settings);
        await saveFirestoreSettings(data.settings);
        if (data.activeContext) {
          await saveFirestoreContext(data.activeContext);
        }
        if (Array.isArray(data.queue)) {
          setQueue(data.queue);
        }
        await fetchStatus();
        await fetchQueue();
      }
    } catch (err) {
      console.error('Error toggling scheduler:', err);
    }
  };

  // Save settings (persists both in local storage & cloud firestore, and clears/regenerates queue)
  const handleSaveSettings = async (newSettingsPartial: Partial<BotSettings>) => {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newSettingsPartial),
    });
    if (res.ok) {
      const data = await res.json();
      setSettings(data.settings);
      await saveFirestoreSettings(data.settings);
      if (data.activeContext) {
        await saveFirestoreContext(data.activeContext);
      }
      if (Array.isArray(data.queue)) {
        setQueue(data.queue);
      }
      await fetchStatus();
      await fetchQueue();
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

  // Clear and regenerate entire 14-slot queue for campaign
  const handleRegenerateQueue = async (contextId?: string) => {
    try {
      const res = await fetch('/api/queue/regenerate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contextId: contextId || activeContextId }),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.queue)) {
          setQueue(data.queue);
        } else {
          await fetchQueue();
        }
      }
    } catch (err) {
      console.error('Error regenerating queue:', err);
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

  const activeContext = contexts.find(c => c.id === activeContextId) || contexts[0];

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-hidden bg-neutral-100/60 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 flex flex-col font-sans antialiased">
      {/* Top Bar with Context Switcher & Navigation */}
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onQuickPost={() => handlePostNow(color || undefined, 'manual')}
        isPosting={isPosting}
        dryRun={settings.dryRun}
        onToggleDryRun={handleToggleDryRun}
        targetTweetId={settings.targetTweetId}
        onUpdateTargetTweetId={handleUpdateTargetTweetId}
        contexts={contexts}
        activeContextId={activeContextId}
        onSelectContext={handleSelectActiveContext}
        rateLimitTelemetry={rateLimitTelemetry}
        cooldownState={cooldownState}
        onOpenRateLimits={() => setIsRateLimitModalOpen(true)}
      />

      {/* Status Bar with live countdown and active context info */}
      <StatusBar
        nextPost={nextPost}
        credentialsStatus={credentialsStatus}
        targetTweetId={settings.targetTweetId}
        schedulerEnabled={settings.schedulerEnabled}
        onToggleScheduler={handleToggleScheduler}
        timezone={settings.timezone}
        scheduleTimes={settings.scheduleTimes}
        settings={settings}
        activeContext={activeContext}
        onChangeFrequency={async (mode, minutes) => {
          if (activeContext) {
            await handleUpdateContext(activeContext.id, {
              schedule: {
                ...activeContext.schedule,
                mode,
                intervalMinutes: minutes ?? activeContext.schedule.intervalMinutes,
              },
            });
          } else {
            await handleSaveSettings({
              intervalMode: mode,
              intervalMinutes: minutes,
            });
          }
        }}
      />

      {/* Main Container Viewport */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 md:p-8">
        {/* Anti-Spam Rate Limit / Reply Cooldown Alert Banner */}
        {cooldownState?.isThrottled && (
          <div className="mb-6 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-start justify-between gap-4">
            <div className="flex items-start gap-3 min-w-0">
              <div className="p-2 rounded-lg bg-amber-500/20 text-amber-500 shrink-0">
                <Clock className="w-5 h-5 animate-pulse" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h4 className="font-semibold text-amber-700 dark:text-amber-300 text-sm">
                    X Anti-Spam Cooldown Active
                  </h4>
                  <span className="px-2 py-0.5 text-xs font-mono font-medium rounded-full bg-amber-500/20 text-amber-700 dark:text-amber-300">
                    {Math.floor(cooldownState.secondsRemaining / 60)}m {cooldownState.secondsRemaining % 60}s remaining
                  </span>
                </div>
                <p className="text-xs text-neutral-600 dark:text-neutral-400 mt-1">
                  {cooldownState.reason || 'X temporarily throttled automated in-thread replies on your account. Automated drops are held in safe standby to allow X to reset the cooldown cleanly.'}
                </p>
                <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5">
                  Tip: Use <strong className="text-neutral-700 dark:text-neutral-300">Quote Tweet mode</strong> or <strong className="text-neutral-700 dark:text-neutral-300">Dry-Run simulation</strong> while in-thread comments cool down.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleClearCooldown}
                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-amber-600 hover:bg-amber-700 text-white transition-colors cursor-pointer"
                title="Override and clear cooldown immediately"
              >
                Clear Cooldown
              </button>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="py-24 text-center text-neutral-500">
            <div className="w-8 h-8 mx-auto mb-3 rounded-full border-2 border-neutral-300 border-t-neutral-800 dark:border-neutral-700 dark:border-t-neutral-200 animate-spin" />
            <p className="text-sm font-medium">Connecting to Cloud Firestore &amp; Multi-Context Engine...</p>
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
                contexts={contexts}
                activeContextId={activeContextId}
                onSelectContext={handleSelectActiveContext}
                onUpdateContext={handleUpdateContext}
              />
            )}

            {activeTab === 'contexts' && (
              <ContextsManager
                contexts={contexts}
                activeContextId={activeContextId}
                nextPosts={allNextPosts}
                onSelectActiveContext={handleSelectActiveContext}
                onCreateContext={handleCreateContext}
                onUpdateContext={handleUpdateContext}
                onDeleteContext={handleDeleteContext}
                onDuplicateContext={handleDuplicateContext}
                onToggleContext={handleToggleContext}
                onTriggerContext={handleTriggerContext}
                onClearContextHistory={handleClearContextHistory}
              />
            )}

            {activeTab === 'queue' && (
              <QueueViewer
                queue={queue}
                onRerollSlot={handleRerollSlot}
                onPostNow={(slotColor, slotType) => handlePostNow(slotColor, slotType)}
                isPosting={isPosting}
                contexts={contexts}
                activeContextId={activeContextId}
                onSelectContext={handleSelectActiveContext}
                onRegenerateQueue={handleRegenerateQueue}
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
            <span>Active: {activeContext?.name || 'Primary'} (#{settings.targetTweetId})</span>
          </div>
          <div className="flex items-center gap-4 text-neutral-400 font-mono text-[11px]">
            <span>Cloud State &amp; Google Auth Active</span>
            <span>·</span>
            <span>Multi-Schedule Context Engine</span>
          </div>
        </div>
      </footer>

      {/* Rate Limits & Anti-Spam Telemetry Modal */}
      <RateLimitModal
        isOpen={isRateLimitModalOpen}
        onClose={() => setIsRateLimitModalOpen(false)}
        telemetry={rateLimitTelemetry}
        cooldownState={cooldownState}
        onClearCooldown={handleClearCooldown}
        onRefreshTelemetry={handleRefreshRateLimits}
      />
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
