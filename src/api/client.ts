/**
 * X ChromaBot - API client
 * Single place where every frontend request to /api/* is built, sent and
 * error-mapped. Auth headers (Firebase ID token, SEC-2) will be attached here.
 */

import { auth, logoutUser } from '../lib/firebase.js';
import { DEV_AUTH_BYPASS } from '../lib/devAuth.js';
import type { ApiResult } from '../types.js';
import { toast } from '../components/ui/toastStore.js';

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Message used when the server response carries no `error` field. */
  errorMessage?: string;
}

/** Builds request headers, including `Authorization: Bearer <Firebase ID token>` when signed in. */
async function buildHeaders(hasBody: boolean): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  if (hasBody) {
    headers['Content-Type'] = 'application/json';
  }
  // Dev auth bypass: the server runs with AUTH_DISABLED, so never send a token.
  const token = DEV_AUTH_BYPASS ? undefined : await auth.currentUser?.getIdToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

export async function apiFetch<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const { method = 'GET', body, errorMessage } = options;
  const hasBody = body !== undefined;
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: await buildHeaders(hasBody),
      body: hasBody ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    toast.error('Cannot reach the server. Check your connection and try again.');
    throw err;
  }

  let data: (ApiResult & Record<string, unknown>) | null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (res.status === 401 && auth.currentUser) {
    // Token rejected: end the session so the UI returns to the login screen.
    void logoutUser();
  }

  if (!res.ok) {
    const apiError = new ApiError(
      data?.error || errorMessage || `Request failed (${res.status})`,
      res.status,
      data,
    );
    // 401 already ends the session and returns to the login screen.
    if (res.status !== 401) toast.error(apiError.message);
    throw apiError;
  }
  return data as T;
}
