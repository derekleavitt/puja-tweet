/**
 * X ChromaBot - Automated Reply Generator
 * Multi-campaign dashboard: the Campaigns screen configures, previews and posts each campaign;
 * Settings only holds global switches. There is no "active campaign" in the UI.
 * Secured behind Google Authentication & synced with Cloud Firestore.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { Header, Tab } from './components/Header.js';
import { StatusBar } from './components/StatusBar.js';
import { ContextsManager } from './features/campaigns/ContextsManager.js';
import { QueueViewer } from './components/QueueViewer.js';
import { SettingsPanel } from './features/settings/SettingsPanel.js';
import { HistoryTable } from './components/HistoryTable.js';
import { TwitterSetup } from './components/TwitterSetup.js';
import { RateLimitModal } from './components/RateLimitModal.js';
import { Footer } from './components/Footer.js';
import { CooldownBanner } from './components/CooldownBanner.js';
import { AuthProvider } from './context/AuthContext.js';
import { AuthGate } from './components/AuthGate.js';
import { usePolling } from './hooks/usePolling.js';
import { ServerInfoContext } from './context/serverInfo.js';
import { useHealth } from './hooks/useHealth.js';
import { useBotStatus } from './hooks/useBotStatus.js';
import { useQueue } from './hooks/useQueue.js';
import { useHistory } from './hooks/useHistory.js';
import { useCredentials } from './hooks/useCredentials.js';
import { useSettings } from './hooks/useSettings.js';
import { usePosting } from './hooks/usePosting.js';
import { useContexts } from './hooks/useContexts.js';
import { useConfirmedPost } from './hooks/useConfirmedPost.js';
import { ConfirmDialog } from './components/ui/ConfirmDialog.js';
import { PostLog } from './types.js';
import { ToastViewport } from './components/ui/Toast.js';
import { useOAuthCallback } from './features/settings/useOAuthCallback.js';
import { accountName, findAccount } from './lib/accounts.js';

function ChromaBotDashboard() {
  const [activeTab, setActiveTab] = useState<Tab>('contexts');
  const [isRateLimitModalOpen, setIsRateLimitModalOpen] = useState<boolean>(false);

  const health = useHealth();
  const status = useBotStatus();
  const { settings, setSettings, contexts, fetchStatus } = status;
  const queueState = useQueue(contexts);
  const { fetchQueue } = queueState;
  const { logs, setLogs, fetchHistory, handleClearHistory } = useHistory();

  const refresh = useCallback(async () => {
    await fetchStatus();
    await fetchQueue();
  }, [fetchStatus, fetchQueue]);
  const addLog = (log: PostLog) => setLogs((prev) => [log, ...prev]);
  // Back from X's authorize page: finish connecting the account, then show Settings.
  useOAuthCallback(() => setActiveTab('settings'), refresh);

  const { isPosting, handlePostNow: postNowDirect } = usePosting({ addLog, refresh });
  const campaignActions = useContexts({ setLogs, refresh, fetchHistory });
  const confirmedPost = useConfirmedPost({ settings, contexts, post: postNowDirect });
  const { handleToggleDryRun, handleToggleGlobalPause } = useSettings({
    settings,
    setSettings,
    refresh,
  });
  const { handleSaveCredentials, handleClearCredentials, handleVerifyCredentials } = useCredentials(
    {
      setCredentialsStatus: status.setCredentialsStatus,
      fetchStatus,
    },
  );

  // Initial load (runs once on mount); the queue loads once the campaigns are known.
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const loadInitial = () => Promise.all([fetchStatus(), fetchHistory()]);
  const loadInitialRef = useRef(loadInitial);
  loadInitialRef.current = loadInitial;
  useEffect(() => {
    let cancelled = false;
    loadInitialRef.current().finally(() => {
      if (!cancelled) setIsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Heartbeat: one /api/status poll every 10 s; paused while the browser tab is hidden.
  // The queue and history are only polled while their screen is open.
  usePolling(fetchStatus, 10000, true);
  usePolling(fetchQueue, 10000, activeTab === 'queue');
  usePolling(fetchHistory, 10000, activeTab === 'history');
  useEffect(() => {
    if (activeTab === 'history') fetchHistory();
  }, [activeTab, fetchHistory]);

  const {
    allNextPosts,
    credentialsStatus,
    cooldownState,
    rateLimitTelemetry,
    handleRefreshRateLimits,
    handleClearCooldown,
  } = status;
  // Cooldowns are per X account: the banner shows the first throttled one.
  const [throttledId, throttled] = Object.entries(status.accountCooldowns).find(
    ([, c]) => c.isThrottled,
  ) ?? ['', cooldownState];
  const throttledName = throttledId
    ? accountName(findAccount(status.serverInfo.accounts, throttledId), throttledId)
    : undefined;

  return (
    <ServerInfoContext.Provider value={status.serverInfo}>
      <div className="min-h-screen w-full max-w-full overflow-x-hidden bg-neutral-100/60 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 flex flex-col font-sans antialiased">
        <Header
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          dryRun={settings.globalDryRun !== false}
          onToggleDryRun={handleToggleDryRun}
          paused={settings.globalPaused !== false}
          onTogglePaused={handleToggleGlobalPause}
          rateLimitTelemetry={rateLimitTelemetry}
          cooldownState={cooldownState}
          onOpenRateLimits={() => setIsRateLimitModalOpen(true)}
        />

        {/* Status bar: the next post across all campaigns */}
        <StatusBar
          contexts={contexts}
          nextPosts={allNextPosts}
          credentialsStatus={credentialsStatus}
          globalPaused={settings.globalPaused !== false}
          onToggleGlobalPause={handleToggleGlobalPause}
        />

        <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 md:p-8">
          {/* Anti-Spam Rate Limit / Reply Cooldown Alert Banner */}
          {throttled?.isThrottled && (
            <CooldownBanner
              cooldownState={throttled}
              accountName={throttledName}
              onClearCooldown={handleClearCooldown}
            />
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
              {activeTab === 'contexts' && (
                <ContextsManager
                  contexts={contexts}
                  settings={settings}
                  nextPosts={allNextPosts}
                  onCreateContext={campaignActions.handleCreateContext}
                  onUpdateContext={campaignActions.handleUpdateContext}
                  onDeleteContext={campaignActions.handleDeleteContext}
                  onDuplicateContext={campaignActions.handleDuplicateContext}
                  onToggleContext={campaignActions.handleToggleContext}
                  onClearContextHistory={campaignActions.handleClearContextHistory}
                  onPostNow={confirmedPost.request}
                />
              )}

              {activeTab === 'queue' && (
                <QueueViewer
                  queue={queueState.queue}
                  contexts={contexts}
                  contextId={queueState.queueContextId}
                  onPickContext={queueState.setQueueContextId}
                  onRerollSlot={queueState.handleRerollSlot}
                  onPostNow={(slot) =>
                    confirmedPost.request(slot.contextId || queueState.queueContextId, {
                      color: slot.color,
                      slotType: slot.slotType,
                      slotId: slot.slotId,
                    })
                  }
                  isPosting={isPosting}
                  onRegenerateQueue={queueState.handleRegenerateQueue}
                />
              )}

              {activeTab === 'history' && (
                <HistoryTable logs={logs} contexts={contexts} onClearHistory={handleClearHistory} />
              )}

              {activeTab === 'settings' && (
                <SettingsPanel
                  settings={settings}
                  contexts={contexts}
                  refresh={refresh}
                  accountCooldowns={status.accountCooldowns}
                  onToggleGlobalDryRun={handleToggleDryRun}
                  onToggleGlobalPause={handleToggleGlobalPause}
                  cooldownState={cooldownState}
                  rateLimitTelemetry={rateLimitTelemetry}
                  onOpenRateLimits={() => setIsRateLimitModalOpen(true)}
                  onClearCooldown={handleClearCooldown}
                />
              )}

              {activeTab === 'credentials' && (
                <TwitterSetup
                  credentialsStatus={credentialsStatus}
                  onSaveCredentials={handleSaveCredentials}
                  onClearCredentials={handleClearCredentials}
                  onVerifyCredentials={handleVerifyCredentials}
                />
              )}
            </>
          )}
        </main>

        <Footer campaignCount={contexts.length} health={health} />

        {confirmedPost.pending && (
          <ConfirmDialog
            title="Post live to X?"
            message={`Campaign "${confirmedPost.pending.campaign}" will post a real tweet as ${accountName(findAccount(status.serverInfo.accounts, confirmedPost.pending.accountId), confirmedPost.pending.accountId)} targeting #${confirmedPost.pending.targetTweetId}.`}
            confirmLabel="Post live"
            onConfirm={confirmedPost.confirm}
            onCancel={confirmedPost.cancel}
          />
        )}

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
    </ServerInfoContext.Provider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AuthGate>
        <ChromaBotDashboard />
      </AuthGate>
      <ToastViewport />
    </AuthProvider>
  );
}
