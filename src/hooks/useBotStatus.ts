/**
 * X ChromaBot - useBotStatus
 * Polled backend status: global settings, campaigns, next posts, credentials, rate limits.
 * The status payload's `queue`/`activeContext` are ignored: the UI has no "active campaign".
 */

import { useState, useCallback } from 'react';
import { ServerInfo } from '../context/serverInfo.js';
import { getStatus, getRateLimits, clearCooldown } from '../api/endpoints.js';
import {
  BotSettings,
  CredentialsStatus,
  TweetContext,
  CooldownState,
  RateLimitTelemetry,
  ContextNextPost,
} from '../types.js';

export function useBotStatus() {
  const [settings, setSettings] = useState<BotSettings>({
    targetTweetId: '',
    scheduleTimes: ['06:00', '18:00'],
    timezone: 'America/Denver',
    schedulerEnabled: true,
    dryRun: false,
    globalDryRun: true,
    globalPaused: true,
    template: '{color_pick} {weather_desc} #eternal #colors',
    themePreference: 'dynamic',
    intervalMode: 'interval',
    intervalMinutes: 15,
  });
  const [contexts, setContexts] = useState<TweetContext[]>([]);
  const [allNextPosts, setAllNextPosts] = useState<ContextNextPost[]>([]);
  const [serverInfo, setServerInfo] = useState<ServerInfo>({ defaultTargetTweetId: '' });
  const [credentialsStatus, setCredentialsStatus] = useState<CredentialsStatus | null>(null);
  const [cooldownState, setCooldownState] = useState<CooldownState | null>(null);
  const [rateLimitTelemetry, setRateLimitTelemetry] = useState<RateLimitTelemetry | null>(null);
  const [accountCooldowns, setAccountCooldowns] = useState<Record<string, CooldownState>>({});

  // Fetch status & state from backend
  const fetchStatus = useCallback(async () => {
    try {
      const data = await getStatus();
      if (data) {
        setSettings(data.settings);
        setServerInfo({
          defaultTargetTweetId: data.defaultTargetTweetId ?? '',
          geminiConfigured: data.geminiConfigured,
          accounts: data.accounts ?? [],
        });
        setAccountCooldowns(data.accountCooldowns ?? {});
        if (data.contexts && data.contexts.length > 0) {
          setContexts(data.contexts);
        }
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
      }
    } catch (err) {
      console.error('Error fetching bot status:', err);
    }
  }, []);

  const handleRefreshRateLimits = async () => {
    try {
      const data = await getRateLimits();
      if (data) {
        if (data.telemetry) setRateLimitTelemetry(data.telemetry);
        if (data.cooldownState) setCooldownState(data.cooldownState);
        if (data.accountCooldowns) {
          setAccountCooldowns(data.accountCooldowns as Record<string, CooldownState>);
        }
      }
    } catch (e) {
      console.error('Failed to refresh rate limits:', e);
    }
  };

  const handleClearCooldown = async () => {
    try {
      const data = await clearCooldown();
      if (data) {
        setCooldownState(data.cooldownState ?? null);
        if (data.accountCooldowns) {
          setAccountCooldowns(data.accountCooldowns as Record<string, CooldownState>);
        }
        await handleRefreshRateLimits();
      }
    } catch (e) {
      console.error('Failed to clear cooldown:', e);
    }
  };

  return {
    settings,
    setSettings,
    contexts,
    allNextPosts,
    serverInfo,
    credentialsStatus,
    setCredentialsStatus,
    cooldownState,
    accountCooldowns,
    rateLimitTelemetry,
    fetchStatus,
    handleRefreshRateLimits,
    handleClearCooldown,
  };
}
