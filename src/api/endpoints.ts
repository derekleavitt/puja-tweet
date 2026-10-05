/**
 * X ChromaBot - typed API endpoints
 * One function per backend route, built on apiFetch.
 */

import { apiFetch, ApiError } from './client.js';
import {
  ApiResult,
  ColorData,
  BotSettings,
  DropResponse,
  DropTextBreakdown,
  HealthInfo,
  PostLog,
  QueueSlot,
  StatusResponse,
  TweetContext,
  VerifyResult,
} from '../types.js';

type Json = ApiResult;

/** Resolves to null (instead of throwing) when the server answers with an error status. */
async function orNull<T>(request: Promise<T>): Promise<T | null> {
  try {
    return await request;
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

/** Resolves to the server's JSON error body (instead of throwing) on an error status. */
async function orBody<T = Json>(request: Promise<T>): Promise<T> {
  try {
    return await request;
  } catch (err) {
    if (err instanceof ApiError) return err.body as T;
    throw err;
  }
}

// Status, telemetry
export const getHealth = () => orNull(apiFetch<HealthInfo>('/api/health'));
export const getStatus = () => orNull(apiFetch<StatusResponse>('/api/status'));
export const getRateLimits = () => orNull(apiFetch<Json>('/api/rate-limits'));
export const clearCooldown = () =>
  orNull(apiFetch<Json>('/api/cooldown/clear', { method: 'POST' }));

// Queue
export const getQueue = (contextId: string) =>
  orNull(apiFetch<{ queue: QueueSlot[] }>(`/api/queue?contextId=${encodeURIComponent(contextId)}`));
export const rerollSlot = (slotId: string) =>
  orNull(apiFetch<Json>('/api/queue/reroll', { method: 'POST', body: { slotId } }));
export const regenerateQueue = (contextId: string) =>
  orNull(apiFetch<Json>('/api/queue/regenerate', { method: 'POST', body: { contextId } }));

// History
export const getHistory = () => orNull(apiFetch<{ logs: PostLog[] }>('/api/history'));
export const clearHistory = () => orNull(apiFetch<Json>('/api/history', { method: 'DELETE' }));

// Posting, templates
export const postNow = (body: {
  slotType: string;
  color: ColorData | null;
  contextId: string;
  text?: string;
  /** Evolved hashtags the previewed `text` used (from the preview response). */
  hashtags?: string[];
  slotId?: string;
}) => orBody(apiFetch<DropResponse>('/api/post-now', { method: 'POST', body }));
export const previewTemplate = (body: {
  /** Omitted: the campaign's own template (what it will post). */
  template?: string;
  color?: ColorData | null;
  slotType?: string;
  contextId?: string;
}) =>
  orBody(
    apiFetch<{
      previewText?: string;
      hashtags?: string[];
      color?: ColorData;
      breakdown?: DropTextBreakdown;
    }>('/api/template/preview', {
      method: 'POST',
      body,
    }),
  );

// Contexts (campaigns)
export const createContext = (data: Partial<TweetContext>) =>
  apiFetch<Json>('/api/contexts', {
    method: 'POST',
    body: data,
    errorMessage: 'Failed to create context',
  });
export const updateContext = (id: string, updates: Partial<TweetContext>) =>
  apiFetch<Json>(`/api/contexts/${id}`, {
    method: 'PUT',
    body: updates,
    errorMessage: 'Failed to update context',
  });
export const deleteContext = (id: string) =>
  apiFetch<Json>(`/api/contexts/${id}`, {
    method: 'DELETE',
    errorMessage: 'Failed to delete context',
  });
export const duplicateContext = (id: string) =>
  orNull(apiFetch<Json>(`/api/contexts/${id}/duplicate`, { method: 'POST' }));
export const toggleContext = (id: string) =>
  orNull(apiFetch<Json>(`/api/contexts/${id}/toggle`, { method: 'POST' }));
export const clearContextHistory = (id: string) =>
  apiFetch<Json>(`/api/contexts/${id}/clear-history`, {
    method: 'POST',
    errorMessage: 'Failed to clear campaign history',
  });

// Settings
export const saveSettings = (settings: Partial<BotSettings> & { contextId?: string }) =>
  orNull(apiFetch<Json>('/api/settings', { method: 'POST', body: settings }));

// Credentials
export const saveCredentials = (creds: Record<string, string>) =>
  orBody(apiFetch<Json>('/api/credentials', { method: 'POST', body: creds }));
export const clearCredentials = (method: 'oauth1' | 'oauth2' | 'bearer') =>
  orBody(apiFetch<Json>(`/api/credentials/${method}`, { method: 'DELETE' }));
export const verifyCredentials = () =>
  orBody(apiFetch<VerifyResult>('/api/twitter/verify', { method: 'POST' }));

// Webhook (admin: the secret is only ever returned by these routes)
export const getWebhookUrl = (contextId?: string) =>
  apiFetch<{ success: boolean; url: string }>(
    contextId ? `/api/webhook/url?contextId=${encodeURIComponent(contextId)}` : '/api/webhook/url',
  );
export const rotateWebhookSecret = () =>
  apiFetch<{ success: boolean; url: string }>('/api/settings/webhook-secret/rotate', {
    method: 'POST',
    errorMessage: 'Failed to rotate webhook secret',
  });
