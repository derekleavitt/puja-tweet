/**
 * X calls used to remove an account's own content ("delete all content" in Settings): list its
 * posts and likes, delete a post, undo a retweet, remove a like. OAuth 1.0a user context of the
 * account itself; query parameters are part of the signature. Every call reports X's rate-limit
 * headers so the caller can wait for the window instead of hammering X.
 */

import { generateOAuth1Header, type TwitterCredentials } from './twitterClient.js';
import { getXTimeoutMs } from './timeouts.js';

const API = 'https://api.x.com/2';

export interface XCallResult {
  status: number;
  body: unknown;
  /** Calls left in the current window, when X says. */
  remaining?: number;
  /** When the window resets (epoch ms), when X says. */
  resetAt?: number;
}

export interface ListedPost {
  id: string;
  /** Source post when this entry is a retweet. */
  retweetOf?: string;
}

export interface ListPage<T> {
  items: T[];
  nextToken?: string;
}

type Creds = Pick<TwitterCredentials, 'apiKey' | 'apiSecret' | 'accessToken' | 'accessTokenSecret'>;

const call = async (
  method: 'GET' | 'DELETE',
  path: string,
  creds: Creds,
  query: Record<string, string> = {},
): Promise<XCallResult> => {
  const url = `${API}${path}`;
  const auth = generateOAuth1Header(
    method,
    url,
    {
      apiKey: creds.apiKey ?? '',
      apiSecret: creds.apiSecret ?? '',
      accessToken: creds.accessToken,
      accessTokenSecret: creds.accessTokenSecret,
    },
    query,
  );
  const qs = new URLSearchParams(query).toString();
  const res = await fetch(qs ? `${url}?${qs}` : url, {
    method,
    headers: { Authorization: auth },
    signal: AbortSignal.timeout(getXTimeoutMs()),
  });
  const remaining = Number(res.headers.get('x-rate-limit-remaining'));
  const reset = Number(res.headers.get('x-rate-limit-reset'));
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // empty or non-JSON body
  }
  return {
    status: res.status,
    body,
    ...(res.headers.has('x-rate-limit-remaining') && Number.isFinite(remaining)
      ? { remaining }
      : {}),
    ...(Number.isFinite(reset) && reset > 0 ? { resetAt: reset * 1000 } : {}),
  };
};

const page = (token?: string): Record<string, string> => ({
  max_results: '100',
  ...(token ? { pagination_token: token } : {}),
});

const dataOf = (body: unknown): unknown[] => {
  const data = (body as { data?: unknown })?.data;
  return Array.isArray(data) ? data : [];
};

const nextTokenOf = (body: unknown): string | undefined => {
  const token = (body as { meta?: { next_token?: unknown } })?.meta?.next_token;
  return typeof token === 'string' && token ? token : undefined;
};

/** One page (newest first) of the account's posts, replies, quotes and retweets. */
export const listPosts = async (creds: Creds, userId: string, token?: string) => {
  const r = await call('GET', `/users/${encodeURIComponent(userId)}/tweets`, creds, {
    ...page(token),
    'tweet.fields': 'referenced_tweets',
  });
  const items: ListedPost[] = dataOf(r.body).flatMap((raw) => {
    const t = raw as { id?: unknown; referenced_tweets?: { type?: string; id?: string }[] };
    if (typeof t.id !== 'string') return [];
    const rt = t.referenced_tweets?.find((ref) => ref.type === 'retweeted')?.id;
    return [{ id: t.id, ...(rt ? { retweetOf: rt } : {}) }];
  });
  return { result: r, page: { items, nextToken: nextTokenOf(r.body) } as ListPage<ListedPost> };
};

/** One page of the posts the account liked. */
export const listLikes = async (creds: Creds, userId: string, token?: string) => {
  const r = await call(
    'GET',
    `/users/${encodeURIComponent(userId)}/liked_tweets`,
    creds,
    page(token),
  );
  const items = dataOf(r.body).flatMap((raw) => {
    const id = (raw as { id?: unknown }).id;
    return typeof id === 'string' ? [id] : [];
  });
  return { result: r, page: { items, nextToken: nextTokenOf(r.body) } as ListPage<string> };
};

export const deletePost = (creds: Creds, id: string) =>
  call('DELETE', `/tweets/${encodeURIComponent(id)}`, creds);

export const undoRetweet = (creds: Creds, userId: string, sourceId: string) =>
  call(
    'DELETE',
    `/users/${encodeURIComponent(userId)}/retweets/${encodeURIComponent(sourceId)}`,
    creds,
  );

export const removeLike = (creds: Creds, userId: string, postId: string) =>
  call('DELETE', `/users/${encodeURIComponent(userId)}/likes/${encodeURIComponent(postId)}`, creds);

export const xContentClient = { listPosts, listLikes, deletePost, undoRetweet, removeLike };
export type XContentClient = typeof xContentClient;
