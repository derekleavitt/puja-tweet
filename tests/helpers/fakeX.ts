/**
 * A fake X API for tests, installed as the global `fetch`.
 *
 * Covers the OAuth 1.0a 3-legged flow (request_token, authorize, access_token), GET /2/users/me and
 * POST /2/tweets. Every request's OAuth 1.0a HMAC-SHA1 signature is recomputed independently of the
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

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

export class FakeX {
  readonly users = new Map<string, FakeUser>();
  readonly requests: RecordedRequest[] = [];
  readonly tweets: RecordedTweet[] = [];
  private readonly requestTokens = new Map<string, RequestToken>();
  /** Queued failures for POST /2/tweets, per signing access token. */
  private readonly postFailures = new Map<string, { status: number; body: unknown }[]>();
  private seq = 1_800_000_000_000_000_000n;
  private tokenSeq = 0;

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

    return json(404, { title: 'Not Found' });
  }
}
