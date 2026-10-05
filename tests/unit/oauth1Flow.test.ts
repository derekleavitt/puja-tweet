import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  generateOAuth1Header,
  oauth1AccessToken,
  oauth1AuthorizeUrl,
  oauth1RequestToken,
  postColorTweet,
} from '../../server/twitterClient.js';

const consumer = { apiKey: 'ck', apiSecret: 'cs' };

/** Header params as a map (values percent-decoded). */
const headerParams = (header: string) =>
  Object.fromEntries(
    [...header.slice('OAuth '.length).matchAll(/(\w+)="([^"]*)"/g)].map((m) => [
      m[1],
      decodeURIComponent(m[2]),
    ]),
  );

const mockFetch = (status: number, body: string) => {
  const fn = vi.fn(async () => new Response(body, { status }));
  vi.stubGlobal('fetch', fn);
  return fn;
};

const authOf = (fn: ReturnType<typeof mockFetch>, call = 0) => {
  const init = (fn.mock.calls[call] as unknown as [string, RequestInit])[1];
  return (init.headers as Record<string, string>).Authorization;
};

afterEach(() => vi.unstubAllGlobals());

describe('generateOAuth1Header without a user token', () => {
  it('omits oauth_token and signs with an empty token secret', () => {
    const header = generateOAuth1Header('POST', 'https://api.x.com/oauth/request_token', consumer, {
      oauth_callback: 'oob',
    });
    const params = headerParams(header);
    expect(params.oauth_token).toBeUndefined();
    expect(params.oauth_callback).toBe('oob');
    expect(params.oauth_signature).toBeTruthy();
  });
});

describe('oauth1RequestToken', () => {
  it('signs the callback, sends no oauth_token and parses the form answer', async () => {
    const fetchFn = mockFetch(
      200,
      'oauth_token=req123&oauth_token_secret=reqsecret&oauth_callback_confirmed=true',
    );
    const out = await oauth1RequestToken(consumer, 'https://bot.example/oauth/x/callback');
    expect(out).toEqual({
      oauthToken: 'req123',
      oauthTokenSecret: 'reqsecret',
      callbackConfirmed: true,
    });
    expect((fetchFn.mock.calls[0] as unknown as [string])[0]).toBe(
      'https://api.x.com/oauth/request_token',
    );
    const params = headerParams(authOf(fetchFn));
    expect(params.oauth_callback).toBe('https://bot.example/oauth/x/callback');
    expect(params.oauth_consumer_key).toBe('ck');
    expect(params.oauth_token).toBeUndefined();
  });

  it('throws a readable error when X refuses', async () => {
    mockFetch(401, '{"errors":[{"code":32,"message":"Could not authenticate you."}]}');
    await expect(oauth1RequestToken(consumer, 'oob')).rejects.toThrow(
      /request-token step \(HTTP 401\): Could not authenticate you/,
    );
  });
});

describe('oauth1AccessToken', () => {
  it('signs with the request token + verifier and parses the user', async () => {
    const fetchFn = mockFetch(
      200,
      'oauth_token=111-user&oauth_token_secret=usersecret&user_id=111&screen_name=second_acct',
    );
    const out = await oauth1AccessToken(consumer, 'req123', 'reqsecret', '9876543');
    expect(out).toEqual({
      accessToken: '111-user',
      accessTokenSecret: 'usersecret',
      userId: '111',
      screenName: 'second_acct',
    });
    const params = headerParams(authOf(fetchFn));
    expect(params.oauth_token).toBe('req123');
    expect(params.oauth_verifier).toBe('9876543');
  });

  it('rejects an incomplete answer', async () => {
    mockFetch(200, 'oauth_token=only');
    await expect(oauth1AccessToken(consumer, 'a', 'b', 'c')).rejects.toThrow(/incomplete/);
  });
});

describe('oauth1AuthorizeUrl', () => {
  it('forces X to ask which account to sign in with', () => {
    expect(oauth1AuthorizeUrl('a b')).toBe(
      'https://api.twitter.com/oauth/authorize?oauth_token=a%20b',
    );
  });
});

describe('postColorTweet error text', () => {
  it("names the posting account's handle (not a global env handle)", async () => {
    vi.stubEnv('X_HANDLE', 'env_handle');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ detail: 'credits depleted' }), {
            status: 402,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );
    const res = await postColorTweet(
      { ...consumer, accessToken: 't', accessTokenSecret: 's' },
      { text: 'hi', engagementMode: 'standalone', accountHandle: 'second_acct' },
    );
    expect(res.error).toContain('@second_acct');
    expect(res.error).not.toContain('env_handle');
    vi.unstubAllEnvs();
  });
});
