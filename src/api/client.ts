/**
 * X ChromaBot - API client
 * Single place where every frontend request to /api/* is built, sent and
 * error-mapped. Auth headers (Firebase ID token, SEC-2) will be attached here.
 */

export class ApiError extends Error {
  status: number;
  body: any;

  constructor(message: string, status: number, body: any) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Message used when the server response carries no `error` field. */
  errorMessage?: string;
}

/** Builds request headers. SEC-2: attach `Authorization: Bearer <Firebase ID token>` here. */
async function buildHeaders(hasBody: boolean): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  if (hasBody) {
    headers['Content-Type'] = 'application/json';
  }
  return headers;
}

export async function apiFetch<T = any>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const { method = 'GET', body, errorMessage } = options;
  const hasBody = body !== undefined;
  const res = await fetch(path, {
    method,
    headers: await buildHeaders(hasBody),
    body: hasBody ? JSON.stringify(body) : undefined,
  });

  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    throw new ApiError(
      data?.error || errorMessage || `Request failed (${res.status})`,
      res.status,
      data,
    );
  }
  return data as T;
}
