/**
 * X ChromaBot - useBotStatus
 * Polled backend status: settings, contexts, next posts, credentials, rate limits.
 */

import { useState, useCallback } from 'react';
import { getStatus, getRateLimits, clearCooldown } from '../api/endpoints.js';
import {
  BotSettings,
  CredentialsStatus,
  NextPostInfo,
  QueueSlot,
  TweetContext,
  CooldownState,
  RateLimitTelemetry,
} from '../types.js';

export function useBotStatus(onQueue: (queue: QueueSlot[]) => void) {
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

  // Fetch status & state from backend
  const fetchStatus = useCallback(async () => {
    try {
      const data = await getStatus();
      if (data) {
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
          onQueue(data.queue);
        }
      }
    } catch (err) {
      console.error('Error fetching bot status:', err);
    }
  }, [onQueue]);

  const handleRefreshRateLimits = async () => {
    try {
      const data = await getRateLimits();
      if (data) {
        if (data.telemetry) setRateLimitTelemetry(data.telemetry);
        if (data.cooldownState) setCooldownState(data.cooldownState);
      }
    } catch (e) {
      console.error('Failed to refresh rate limits:', e);
    }
  };

  const handleClearCooldown = async () => {
    try {
      const data = await clearCooldown();
      if (data) {
        setCooldownState(data.cooldownState);
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
    activeContextId,
    setActiveContextId,
    nextPost,
    allNextPosts,
    credentialsStatus,
    setCredentialsStatus,
    cooldownState,
    rateLimitTelemetry,
    fetchStatus,
    handleRefreshRateLimits,
    handleClearCooldown,
  };
}
