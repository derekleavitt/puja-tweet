/**
 * A fake X API for tests, installed as the global `fetch`.
 *
 * Covers the OAuth 1.0a 3-legged flow (request_token, authorize, access_token), GET /2/users/me,
 * POST /2/tweets, and the content-removal calls: user timeline, liked posts, DELETE a post, undo a
 * retweet, remove a like (with optional rate-limit windows). Every request's OAuth 1.0a HMAC-SHA1 signature is recomputed independently of the
 * production signer and checked against the consumer secret + the secret of the token it names;
 * a bad signature is answered 401 like X does. Each request records which token signed it.
 */

import crypto from 'crypto';
import { vi } from 'vitest';

export interface FakeUser {
  userId: string;
  screenName: string;
  accessToken: string;
  accessTokenSecret: string;
  revoked?: boolean;
}

export interface RecordedRequest {
  method: string;
  path: string;
  /** oauth_token that signed the request ('' for request_token). */
  token: string;
  signatureValid: boolean;
}

export interface RecordedTweet {
  id: string;
  authorId: string;
  token: string;
  text: string;
  inReplyTo?: string;
  quoteOf?: string;
}

interface RequestToken {
  secret: string;
  callback: string;
  userId?: string;
  verifier?: string;
}

const enc = (s: string) =>
  encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

const parseAuthHeader = (header: string): Record<string, string> =>
  Object.fromEntries(
    [...header.replace(/^OAuth\s+/, '').matchAll(/([\w]+)="([^"]*)"/g)].map((m) => [
      decodeURIComponent(m[1]),
      decodeURIComponent(m[2]),
    ]),
  );

/** RFC 5849 signature base string over the oauth params + query params (JSON bodies are not signed). */
const expectedSignature = (
  method: string,
  url: URL,
  params: Record<string, string>,
  consumerSecret: string,
  tokenSecret: string,
) => {
  const all: [string, string][] = [
    ...Object.entries(params).filter(([k]) => k !== 'oauth_signature'),
    ...url.searchParams.entries(),
  ];
  const paramString = all
    .map(([k, v]) => [enc(k), enc(v)])
    .sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : 1) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const base = [method.toUpperCase(), enc(`${url.origin}${url.pathname}`), enc(paramString)].join(
    '&',
  );
  return crypto
    .createHmac('sha1', `${enc(consumerSecret)}&${enc(tokenSecret)}`)
    .update(base)
    .digest('base64');
};

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

/** Rate-limited endpoints of the fake (one window each, shared by every user). */
export type FakeWindow = 'timeline' | 'likedList' | 'deletePost' | 'unretweet' | 'unlike';

export class FakeX {
  readonly users = new Map<string, FakeUser>();
  readonly requests: RecordedRequest[] = [];
  readonly tweets: RecordedTweet[] = [];
  private readonly requestTokens = new Map<string, RequestToken>();
  /** Queued failures for POST /2/tweets, per signing access token. */
  private readonly postFailures = new Map<string, { status: number; body: unknown }[]>();
  private seq = 1_800_000_000_000_000_000n;
  private tokenSeq = 0;
  /** Retweets per user: [the retweet's own id, the source post id], newest last. */
  readonly retweets = new Map<string, { id: string; sourceId: string }[]>();
  /** Liked post ids per user, newest last. */
  readonly likes = new Map<string, string[]>();
  /** Rate windows: calls left and the reset time (epoch seconds). */
  readonly windows = new Map<FakeWindow, { remaining: number; reset: number }>();
  /** X lists only the newest N timeline entries. */
  timelineCap = 3200;
  /** The X plan cannot read timelines / likes (403). */
  refuseReads = false;
  /** The app's pay-per-use credits are used up: every content call answers 402. */
  outOfCredits = false;

  constructor(
    readonly consumerKey = 'fake-consumer-key',
    readonly consumerSecret = 'fake-consumer-secret-XYZ',
  ) {}

  addUser(userId: string, screenName: string): FakeUser {
    const user: FakeUser = {
      userId,
      screenName,
      accessToken: `${userId}-access-token-${screenName}`,
      accessTokenSecret: `access-secret-${screenName}-${crypto.randomBytes(4).toString('hex')}`,
    };
    this.users.set(userId, user);
    return user;
  }

  /** The owner signs in as `userId` on X's authorize page and approves the app. */
  authorize(oauthToken: string, userId: string): { verifier: string; redirect?: string } {
    const rt = this.requestTokens.get(oauthToken);
    if (!rt) throw new Error(`fake X: unknown request token ${oauthToken}`);
    rt.userId = userId;
    rt.verifier = String(1_000_000 + this.tokenSeq++);
    if (rt.callback === 'oob') return { verifier: rt.verifier };
    const redirect = new URL(rt.callback);
    redirect.searchParams.set('oauth_token', oauthToken);
    redirect.searchParams.set('oauth_verifier', rt.verifier);
    return { verifier: rt.verifier, redirect: redirect.toString() };
  }

  /** The next POST /2/tweets signed by this user answers `status` (once per call). */
  failNextPost(userId: string, status: number, body: unknown = { title: 'Error' }) {
    const token = this.users.get(userId)!.accessToken;
    this.postFailures.set(token, [...(this.postFailures.get(token) ?? []), { status, body }]);
  }

  /** Every secret the fake handed out or holds: none may ever appear in a response or log. */
  secrets(): string[] {
    return [
      this.consumerSecret,
      ...[...this.users.values()].flatMap((u) => [u.accessToken, u.accessTokenSecret]),
      ...[...this.requestTokens.values()].map((t) => t.secret),
    ];
  }

  tweetsBy(userId: string) {
    return this.tweets.filter((t) => t.authorId === userId);
  }

  /** Content that exists before the test: a post, a retweet or a like by `userId`. */
  seedPost(userId: string, text = 'old post'): string {
    const id = String(this.seq++);
    this.tweets.push({ id, authorId: userId, token: '', text });
    return id;
  }

  seedRetweet(userId: string, sourceId: string) {
    const list = this.retweets.get(userId) ?? [];
    list.push({ id: String(this.seq++), sourceId });
    this.retweets.set(userId, list);
  }

  seedLike(userId: string, postId: string) {
    this.likes.set(userId, [...(this.likes.get(userId) ?? []), postId]);
  }

  /** Every id the user's timeline still shows (posts and retweets), newest first. */
  timelineOf(userId: string): { id: string; retweetOf?: string }[] {
    return [
      ...this.tweetsBy(userId).map((t) => ({ id: t.id })),
      ...(this.retweets.get(userId) ?? []).map((r) => ({ id: r.id, retweetOf: r.sourceId })),
    ].sort((a, b) => (BigInt(b.id) > BigInt(a.id) ? 1 : -1));
  }

  /** Counts one call against `window`; a 429 response when it is used up. */
  private spend(window: FakeWindow): Response | Record<string, string> {
    const w = this.windows.get(window);
    if (!w) return {};
    if (w.remaining <= 0) {
      return json(429, { title: 'Too Many Requests' }, { 'x-rate-limit-reset': String(w.reset) });
    }
    w.remaining--;
    return { 'x-rate-limit-remaining': String(w.remaining), 'x-rate-limit-reset': String(w.reset) };
  }

  private paged<T>(all: T[], url: URL, toData: (x: T) => unknown, headers: Record<string, string>) {
    const max = Number(url.searchParams.get('max_results') || 10);
    const start = Number(url.searchParams.get('pagination_token') || 0);
    const slice = all.slice(start, start + max);
    const next = start + max < all.length ? String(start + max) : undefined;
    return json(
      200,
      {
        ...(slice.length ? { data: slice.map(toData) } : {}),
        meta: { result_count: slice.length, ...(next ? { next_token: next } : {}) },
      },
      headers,
    );
  }

  install() {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL, init?: RequestInit) => this.handle(input, init)),
    );
    return this;
  }

  private userByToken(token: string) {
    return [...this.users.values()].find((u) => u.accessToken === token);
  }

  private async handle(input: string | URL, init: RequestInit = {}): Promise<Response> {
    const url = new URL(String(input));
    const method = (init.method || 'GET').toUpperCase();
    const headers = (init.headers ?? {}) as Record<string, string>;
    const params = parseAuthHeader(headers.Authorization || '');
    const token = params.oauth_token || '';

    // Secret for the token named in the header: a request token, a user token, or none.
    const tokenSecret =
      this.requestTokens.get(token)?.secret ?? this.userByToken(token)?.accessTokenSecret ?? '';
    const signatureValid =
      params.oauth_consumer_key === this.consumerKey &&
      params.oauth_signature_method === 'HMAC-SHA1' &&
      !!params.oauth_signature &&
      params.oauth_signature ===
        expectedSignature(method, url, params, this.consumerSecret, tokenSecret);
    this.requests.push({ method, path: url.pathname, token, signatureValid });
    if (!signatureValid) {
      return json(401, { errors: [{ code: 32, message: 'Could not authenticate you.' }] });
    }

    if (method === 'POST' && url.pathname === '/oauth/request_token') {
      if (token) return json(400, { errors: [{ message: 'unexpected oauth_token' }] });
      const callback = params.oauth_callback;
      if (!callback) return json(400, { errors: [{ message: 'oauth_callback missing' }] });
      const oauthToken = `reqtok-${++this.tokenSeq}`;
      const secret = `reqsecret-${crypto.randomBytes(6).toString('hex')}`;
      this.requestTokens.set(oauthToken, { secret, callback });
      return new Response(
        `oauth_token=${oauthToken}&oauth_token_secret=${secret}&oauth_callback_confirmed=true`,
      );
    }

    if (method === 'POST' && url.pathname === '/oauth/access_token') {
      const rt = this.requestTokens.get(token);
      if (!rt || !rt.userId || params.oauth_verifier !== rt.verifier) {
        return json(401, { errors: [{ code: 89, message: 'Invalid or expired token.' }] });
      }
      this.requestTokens.delete(token);
      const user = this.users.get(rt.userId)!;
      return new Response(
        `oauth_token=${user.accessToken}&oauth_token_secret=${user.accessTokenSecret}` +
          `&user_id=${user.userId}&screen_name=${user.screenName}`,
      );
    }

    const user = this.userByToken(token);
    if (!user || user.revoked) return json(401, { title: 'Unauthorized', status: 401 });

    if (method === 'GET' && url.pathname === '/2/users/me') {
      return json(200, {
        data: { id: user.userId, username: user.screenName, name: user.screenName },
      });
    }

    if (method === 'POST' && url.pathname === '/2/tweets') {
      const failure = this.postFailures.get(token)?.shift();
      if (failure) return json(failure.status, failure.body);
      const body = JSON.parse(String(init.body)) as {
        text: string;
        reply?: { in_reply_to_tweet_id: string };
        quote_tweet_id?: string;
      };
      const id = String(this.seq++);
      this.tweets.push({
        id,
        authorId: user.userId,
        token,
        text: body.text,
        inReplyTo: body.reply?.in_reply_to_tweet_id,
        quoteOf: body.quote_tweet_id,
      });
      return json(201, { data: { id, text: body.text } });
    }

    return this.handleContent(method, url, user) ?? json(404, { title: 'Not Found' });
  }

  /** Timeline, liked posts and the three removal calls (only for the signing user's own content). */
  private handleContent(method: string, url: URL, user: FakeUser): Response | undefined {
    const path = url.pathname;
    const own = (id: string) => id === user.userId;
    const limited = (window: FakeWindow) => this.spend(window);
    let m: RegExpExecArray | null;
    if (this.outOfCredits && /^\/2\/(users|tweets)\//.test(path) && path !== '/2/users/me') {
      return json(402, {
        title: 'CreditsDepleted',
        detail: 'Your enrolled account does not have any credits to fulfill this request.',
      });
    }

    if (method === 'GET' && (m = /^\/2\/users\/(\d+)\/tweets$/.exec(path)) && own(m[1])) {
      const h = limited('timeline');
      if (h instanceof Response) return h;
      if (this.refuseReads) return json(403, { title: 'Client Forbidden' });
      const all = this.timelineOf(user.userId).slice(0, this.timelineCap);
      return this.paged(
        all,
        url,
        (t) => ({
          id: t.id,
          text: 'x',
          ...(t.retweetOf ? { referenced_tweets: [{ type: 'retweeted', id: t.retweetOf }] } : {}),
        }),
        h,
      );
    }
    if (method === 'GET' && (m = /^\/2\/users\/(\d+)\/liked_tweets$/.exec(path)) && own(m[1])) {
      const h = limited('likedList');
      if (h instanceof Response) return h;
      if (this.refuseReads) return json(403, { title: 'Client Forbidden' });
      const all = [...(this.likes.get(user.userId) ?? [])].reverse();
      return this.paged(all, url, (id) => ({ id, text: 'x' }), h);
    }
    if (method === 'DELETE' && (m = /^\/2\/tweets\/(\d+)$/.exec(path))) {
      const h = limited('deletePost');
      if (h instanceof Response) return h;
      const i = this.tweets.findIndex((t) => t.id === m![1]);
      if (i < 0) return json(404, { title: 'Not Found' }, h);
      if (this.tweets[i].authorId !== user.userId) return json(403, { title: 'Forbidden' }, h);
      this.tweets.splice(i, 1);
      return json(200, { data: { deleted: true } }, h);
    }
    if (
      method === 'DELETE' &&
      (m = /^\/2\/users\/(\d+)\/retweets\/(\d+)$/.exec(path)) &&
      own(m[1])
    ) {
      const h = limited('unretweet');
      if (h instanceof Response) return h;
      const list = this.retweets.get(user.userId) ?? [];
      this.retweets.set(
        user.userId,
        list.filter((r) => r.sourceId !== m![2]),
      );
      return json(200, { data: { retweeted: false } }, h);
    }
    if (method === 'DELETE' && (m = /^\/2\/users\/(\d+)\/likes\/(\d+)$/.exec(path)) && own(m[1])) {
      const h = limited('unlike');
      if (h instanceof Response) return h;
      const list = this.likes.get(user.userId) ?? [];
      this.likes.set(
        user.userId,
        list.filter((id) => id !== m![2]),
      );
      return json(200, { data: { liked: false } }, h);
    }
    return undefined;
  }
}
