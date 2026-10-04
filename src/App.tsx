/**
 * X ChromaBot - Automated Color Reply Generator
 * Multi-Context Autonomous Architecture
 * Secured behind Google Authentication & synced with Cloud Firestore.
 */

import { useState, useCallback } from 'react';
import { Header } from './components/Header.js';
import { StatusBar } from './components/StatusBar.js';
import { LiveStudio } from './components/LiveStudio.js';
import { ContextsManager } from './features/campaigns/ContextsManager.js';
import { QueueViewer } from './components/QueueViewer.js';
import { SettingsPanel } from './components/SettingsPanel.js';
import { HistoryTable } from './components/HistoryTable.js';
import { TwitterSetup } from './components/TwitterSetup.js';
import { RateLimitModal } from './components/RateLimitModal.js';
import { Footer } from './components/Footer.js';
import { CooldownBanner } from './components/CooldownBanner.js';
import { AuthProvider } from './context/AuthContext.js';
import { AuthGate } from './components/AuthGate.js';
import { usePolling } from './hooks/usePolling.js';
import { useBotStatus } from './hooks/useBotStatus.js';
import { useQueue } from './hooks/useQueue.js';
import { useHistory } from './hooks/useHistory.js';
import { useCredentials } from './hooks/useCredentials.js';
import { useSettings } from './hooks/useSettings.js';
import { usePosting } from './hooks/usePosting.js';
import { useContexts } from './hooks/useContexts.js';
import { useCloudBootstrap } from './hooks/useCloudBootstrap.js';
import { PostLog } from './types.js';

function ChromaBotDashboard() {
  const [activeTab, setActiveTab] = useState<string>('studio');
  const [isRateLimitModalOpen, setIsRateLimitModalOpen] = useState<boolean>(false);

  const { queue, setQueue, fetchQueue, handleRerollSlot, handleRegenerateQueue } = useQueue();
  const status = useBotStatus(setQueue);
  const { settings, setSettings, contexts, activeContextId, setActiveContextId, fetchStatus } =
    status;
  const { logs, setLogs, fetchHistory, handleClearHistory } = useHistory();

  const refresh = useCallback(async () => {
    await fetchStatus();
    await fetchQueue();
  }, [fetchStatus, fetchQueue]);
  const addLog = (log: PostLog) => setLogs((prev) => [log, ...prev]);

  const { color, isPosting, lastPostedResult, generateColor, handlePostNow } = usePosting({
    activeContextId,
    addLog,
    refresh,
  });
  const {
    handleSelectActiveContext,
    handleCreateContext,
    handleUpdateContext,
    handleDeleteContext,
    handleDuplicateContext,
    handleToggleContext,
    handleTriggerContext,
    handleClearContextHistory,
  } = useContexts({
    setActiveContextId,
    setQueue,
    setLogs,
    addLog,
    refresh,
    fetchHistory,
    generateColor,
  });
  const {
    handleSaveSettings,
    handleToggleDryRun,
    handleToggleScheduler,
    handleUpdateTargetTweetId,
  } = useSettings({ settings, setSettings, setQueue, refresh });
  const { handleSaveCredentials, handleVerifyCredentials } = useCredentials({
    setCredentialsStatus: status.setCredentialsStatus,
    fetchStatus,
  });

  // Initial load: check Firestore for saved cloud contexts & settings (runs once on mount)
  const { isLoading } = useCloudBootstrap({
    setSettings,
    loadInitialData: () =>
      Promise.all([fetchStatus(), fetchQueue(), fetchHistory(), generateColor('morning')]),
  });

  // Heartbeat poll every 8 seconds
  usePolling(
    () => {
      fetchStatus();
      fetchHistory();
      fetchQueue();
    },
    8000,
    true,
  );

  const {
    allNextPosts,
    nextPost,
    credentialsStatus,
    cooldownState,
    rateLimitTelemetry,
    handleRefreshRateLimits,
    handleClearCooldown,
  } = status;

  const activeContext = contexts.find((c) => c.id === activeContextId) || contexts[0];

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
          <CooldownBanner cooldownState={cooldownState} onClearCooldown={handleClearCooldown} />
        )}

        {isLoading ? (
          <div className="py-24 text-center text-neutral-500">
            <div className="w-8 h-8 mx-auto mb-3 rounded-full border-2 border-neutral-300 border-t-neutral-800 dark:border-neutral-700 dark:border-t-neutral-200 animate-spin" />
            <p className="text-sm font-medium">
              Connecting to Cloud Firestore &amp; Multi-Context Engine...
            </p>
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
                onRegenerateQueue={(contextId) =>
                  handleRegenerateQueue(contextId || activeContextId)
                }
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
          </>
        )}
      </main>

      {/* Clean Unboxed Footer */}
      <Footer
        activeName={activeContext?.name || 'Primary'}
        targetTweetId={settings.targetTweetId}
      />

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
