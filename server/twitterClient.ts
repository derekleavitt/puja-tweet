/**
 * Twitter / X API v2 Client
 * Supports:
 * 1. OAuth 1.0a User Context (Permanent API Key, API Secret, Access Token, Access Token Secret)
 * 2. OAuth 2.0 User Context (Client ID, Client Secret, Access Token, Refresh Token with auto-renewal)
 * 3. OAuth 2.0 Bearer Token
 */

import crypto from 'crypto';
import { getXTimeoutMs, isTimeoutError } from './timeouts.js';

export interface TwitterCredentials {
  // OAuth 1.0a (Permanent)
  apiKey?: string;
  apiSecret?: string;
  accessToken?: string;
  accessTokenSecret?: string;

  // OAuth 2.0 (Modern)
  oauth2ClientId?: string;
  oauth2ClientSecret?: string;
  oauth2AccessToken?: string;
  oauth2RefreshToken?: string;

  // App-only Bearer
  bearerToken?: string;
}

export interface PostTweetOptions {
  text: string;
  replyToTweetId?: string;
  quoteTweetId?: string;
  engagementMode?: 'reply' | 'quote' | 'standalone';
  autoFallbackToQuote?: boolean;
}

export interface RateLimitHeaders {
  limit?: number;
  remaining?: number;
  reset?: number; // epoch timestamp in seconds
  appDailyLimit?: number;
  userDailyLimit?: number;
  retryAfter?: number;
}

export interface TweetResponse {
  success: boolean;
  tweetId?: string;
  text?: string;
  replyTo?: string;
  quoteTweetId?: string;
  url?: string;
  error?: string;
  rawResponse?: any;
  simulated?: boolean;
  engagementMode?: 'reply' | 'quote' | 'standalone';
  fallbackTriggered?: boolean;
  isRateLimitOrCooldown?: boolean;
  isTimeout?: boolean;
  rateLimitReset?: number;
  rateLimitHeaders?: RateLimitHeaders;
}

export function parseRateLimitHeaders(headers: Headers): RateLimitHeaders {
  const limit = headers.get('x-rate-limit-limit');
  const remaining = headers.get('x-rate-limit-remaining');
  const reset = headers.get('x-rate-limit-reset');
  const appDaily = headers.get('x-app-limit-24hour-limit');
  const userDaily = headers.get('x-user-limit-24hour-limit');
  const retryAfter = headers.get('retry-after');

  return {
    limit: limit ? parseInt(limit, 10) : undefined,
    remaining: remaining ? parseInt(remaining, 10) : undefined,
    reset: reset ? parseInt(reset, 10) : undefined,
    appDailyLimit: appDaily ? parseInt(appDaily, 10) : undefined,
    userDailyLimit: userDaily ? parseInt(userDaily, 10) : undefined,
    retryAfter: retryAfter ? parseInt(retryAfter, 10) : undefined,
  };
}

function percentEncode(str: string): string {
  return encodeURIComponent(str)
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A');
}

export function generateOAuth1Header(
  method: string,
  url: string,
  creds: {
    apiKey: string;
    apiSecret: string;
    accessToken: string;
    accessTokenSecret: string;
  },
  extraParams: Record<string, string> = {}
): string {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: creds.accessToken,
    oauth_version: '1.0',
    ...extraParams,
  };

  const sortedKeys = Object.keys(oauthParams).sort();
  const paramString = sortedKeys
    .map(key => `${percentEncode(key)}=${percentEncode(oauthParams[key])}`)
    .join('&');

  const baseString = [
    method.toUpperCase(),
    percentEncode(url),
    percentEncode(paramString),
  ].join('&');

  const signingKey = `${percentEncode(creds.apiSecret)}&${percentEncode(creds.accessTokenSecret)}`;

  const signature = crypto
    .createHmac('sha1', signingKey)
    .update(baseString)
    .digest('base64');

  oauthParams.oauth_signature = signature;

  const headerParts = Object.keys(oauthParams)
    .filter(k => k.startsWith('oauth_'))
    .sort()
    .map(k => `${percentEncode(k)}="${percentEncode(oauthParams[k])}"`);

  return `OAuth ${headerParts.join(', ')}`;
}

export async function refreshOAuth2Token(
  creds: TwitterCredentials
): Promise<{ accessToken: string; refreshToken?: string } | null> {
  if (!creds.oauth2ClientId || !creds.oauth2ClientSecret || !creds.oauth2RefreshToken) {
    return null;
  }

  try {
    const basic = Buffer.from(`${creds.oauth2ClientId}:${creds.oauth2ClientSecret}`).toString('base64');
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: creds.oauth2RefreshToken,
      client_id: creds.oauth2ClientId,
    });

    const res = await fetch('https://api.x.com/2/oauth2/token', {
      signal: AbortSignal.timeout(getXTimeoutMs()),
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'X-ChromaBot/1.0',
      },
      body: params.toString(),
    });

    if (res.ok) {
      const data = await res.json();
      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
      };
    }
  } catch (err) {
    console.error('Failed to refresh OAuth 2.0 token:', err);
  }
  return null;
}

export async function verifyTwitterCredentials(
  creds: TwitterCredentials
): Promise<{ valid: boolean; user?: any; message: string }> {
  // 1. Try OAuth 1.0a User Context (Permanent)
  if (creds.apiKey && creds.apiSecret && creds.accessToken && creds.accessTokenSecret) {
    const url = 'https://api.x.com/2/users/me';
    try {
      const authHeader = generateOAuth1Header('GET', url, {
        apiKey: creds.apiKey,
        apiSecret: creds.apiSecret,
        accessToken: creds.accessToken,
        accessTokenSecret: creds.accessTokenSecret,
      });

      const res = await fetch(url, {
        signal: AbortSignal.timeout(getXTimeoutMs()),
        method: 'GET',
        headers: {
          Authorization: authHeader,
          'User-Agent': 'X-ChromaBot/1.0',
        },
      });

      const body = await res.json();
      if (res.ok && body.data) {
        return {
          valid: true,
          user: body.data,
          message: `Authenticated via OAuth 1.0a as @${body.data.username} (${body.data.name})`,
        };
      } else {
        const errMsg = body?.detail || body?.title || body?.errors?.[0]?.message || `HTTP ${res.status}: ${res.statusText}`;
        return {
          valid: false,
          message: `OAuth 1.0a verification failed: ${errMsg}.`,
        };
      }
    } catch (err: any) {
      return {
        valid: false,
        message: `Network error connecting to X API: ${err.message}`,
      };
    }
  }

  // 2. Try OAuth 2.0 User Context Token
  const oauth2Token = creds.oauth2AccessToken;
  if (oauth2Token) {
    try {
      const res = await fetch('https://api.x.com/2/users/me', {
        signal: AbortSignal.timeout(getXTimeoutMs()),
        headers: {
          Authorization: `Bearer ${oauth2Token}`,
          'User-Agent': 'X-ChromaBot/1.0',
        },
      });

      const body = await res.json();
      if (res.ok && body.data) {
        return {
          valid: true,
          user: body.data,
          message: `Authenticated via OAuth 2.0 User Context as @${body.data.username} (${body.data.name})`,
        };
      }

      // If token expired, attempt refresh
      if (res.status === 401 && creds.oauth2RefreshToken) {
        const refreshed = await refreshOAuth2Token(creds);
        if (refreshed) {
          creds.oauth2AccessToken = refreshed.accessToken;
          if (refreshed.refreshToken) creds.oauth2RefreshToken = refreshed.refreshToken;
          return verifyTwitterCredentials(creds);
        }
      }

      return {
        valid: false,
        message: `OAuth 2.0 verification: ${body?.detail || body?.title || `HTTP ${res.status}`}`,
      };
    } catch (err: any) {
      return { valid: false, message: err.message };
    }
  }

  // 3. Fallback: App-only Bearer token
  if (creds.bearerToken) {
    return {
      valid: false,
      message: 'Bearer Token detected, but it is "Application-Only". Twitter requires User Context (OAuth 1.0a or OAuth 2.0 User Token) to post tweets on your behalf.',
    };
  }

  return {
    valid: false,
    message: 'No credentials configured yet. Provide OAuth 1.0a or OAuth 2.0 credentials.',
  };
}

export async function postColorTweet(
  creds: TwitterCredentials,
  options: PostTweetOptions,
  isDryRun = false
): Promise<TweetResponse> {
  const hasOAuth1 = !!(creds.apiKey && creds.apiSecret && creds.accessToken && creds.accessTokenSecret);
  const hasOAuth2User = !!creds.oauth2AccessToken;

  if (isDryRun || (!hasOAuth1 && !hasOAuth2User)) {
    const fakeTweetId = `sim_${Date.now()}`;
    return {
      success: true,
      tweetId: fakeTweetId,
      text: options.text,
      replyTo: options.replyToTweetId,
      quoteTweetId: options.quoteTweetId,
      engagementMode: options.engagementMode || (options.quoteTweetId ? 'quote' : options.replyToTweetId ? 'reply' : 'standalone'),
      url: `https://x.com/i/status/${fakeTweetId}`,
      simulated: true,
      rawResponse: {
        data: { id: fakeTweetId, text: options.text },
        mode: isDryRun ? 'dry_run_simulation' : 'no_user_credentials_simulation',
      },
    };
  }

    const endpoint = 'https://api.x.com/2/tweets';
    const mode = options.engagementMode || (options.quoteTweetId ? 'quote' : 'reply');
    const bodyPayload: Record<string, any> = {
      text: options.text,
    };

    if (mode === 'reply') {
      if (!options.replyToTweetId || !/^\d+$/.test(options.replyToTweetId.trim())) {
        return {
          success: false,
          error: 'Missing or invalid target Tweet ID for reply. Refusing to post as a standalone tweet to your timeline.',
        };
      }
      bodyPayload.reply = {
        in_reply_to_tweet_id: options.replyToTweetId.trim(),
      };
    } else if (mode === 'quote') {
      if (!options.quoteTweetId || !/^\d+$/.test(options.quoteTweetId.trim())) {
        return {
          success: false,
          error: 'Missing or invalid target Tweet ID for quote tweet.',
        };
      }
      bodyPayload.quote_tweet_id = options.quoteTweetId.trim();
    }

    let authHeader = '';
    if (hasOAuth1) {
      authHeader = generateOAuth1Header('POST', endpoint, {
        apiKey: creds.apiKey!,
        apiSecret: creds.apiSecret!,
        accessToken: creds.accessToken!,
        accessTokenSecret: creds.accessTokenSecret!,
      });
    } else if (hasOAuth2User) {
      authHeader = `Bearer ${creds.oauth2AccessToken}`;
    }

    try {
      let response = await fetch(endpoint, {
        signal: AbortSignal.timeout(getXTimeoutMs()),
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
          'User-Agent': 'X-ChromaBot/1.0',
        },
        body: JSON.stringify(bodyPayload),
      });

      // If OAuth 2.0 token expired (HTTP 401), try refreshing
      if (response.status === 401 && creds.oauth2RefreshToken) {
        const refreshed = await refreshOAuth2Token(creds);
        if (refreshed) {
          creds.oauth2AccessToken = refreshed.accessToken;
          if (refreshed.refreshToken) creds.oauth2RefreshToken = refreshed.refreshToken;
          authHeader = `Bearer ${creds.oauth2AccessToken}`;
          response = await fetch(endpoint, {
            signal: AbortSignal.timeout(getXTimeoutMs()),
            method: 'POST',
            headers: {
              Authorization: authHeader,
              'Content-Type': 'application/json',
              'User-Agent': 'X-ChromaBot/1.0',
            },
            body: JSON.stringify(bodyPayload),
          });
        }
      }

      const data = await response.json();

      if (!response.ok) {
        let errorMsg = data?.detail || data?.title || data?.errors?.[0]?.message || `HTTP ${response.status}: ${response.statusText}`;
        if (response.status === 402 || data?.detail?.includes('credits depleted')) {
          errorMsg = 'X API Error: Credits Depleted (HTTP 402 Payment Required). Your account authentication as @bhaijahndai is verified, but X now requires active credits in your developer.x.com portal under Billing to post live tweets.';
        } else if (response.status === 403 && data?.detail?.includes('only reply to or quote posts where you are mentioned or are the author')) {
          errorMsg = 'X API Authorization Rule: X requires that the target reply tweet must be authored by your account (@bhaijahndai) or have mentioned @bhaijahndai. Use the "Change Target Post ID" box above to enter a tweet authored by @bhaijahndai.';
        } else if (response.status === 403 && data?.detail?.includes('not permitted to access this feature')) {
          errorMsg = 'X API Reply Cooldown: X temporarily throttled in-thread replies on your developer account ("Your account is not permitted to access this feature"). This occurs when automated replies are sent too frequently (e.g., every 1m). Standby while X resets the automated reply cooldown, or increase the interval between drops.';
        } else if (response.status === 429) {
          errorMsg = 'X API Rate Limit Exceeded (HTTP 429). The maximum request rate for the current 15-minute window has been reached.';
        }

        const resetHeader = response.headers.get('x-rate-limit-reset');
        const rateLimitReset = resetHeader ? parseInt(resetHeader, 10) * 1000 : (Date.now() + 15 * 60 * 1000);
        const isRateLimitOrCooldown = response.status === 429 || (response.status === 403 && (data?.detail?.includes('not permitted to access this feature') || data?.detail?.includes('cooldown')));

        return {
          success: false,
          error: errorMsg,
          rawResponse: data,
          isRateLimitOrCooldown,
          rateLimitReset: isRateLimitOrCooldown ? rateLimitReset : undefined,
          rateLimitHeaders: parseRateLimitHeaders(response.headers),
        };
      }

      const postedTweetId = data?.data?.id;
      return {
        success: true,
        tweetId: postedTweetId,
        text: data?.data?.text || options.text,
        replyTo: options.replyToTweetId,
        quoteTweetId: options.quoteTweetId,
        engagementMode: options.engagementMode || (options.quoteTweetId ? 'quote' : options.replyToTweetId ? 'reply' : 'standalone'),
        url: postedTweetId ? `https://x.com/i/status/${postedTweetId}` : undefined,
        rawResponse: data,
        rateLimitHeaders: parseRateLimitHeaders(response.headers),
      };
  } catch (err: any) {
    if (isTimeoutError(err)) {
      return {
        success: false,
        error: `X API timeout after ${getXTimeoutMs()} ms`,
        isTimeout: true,
      };
    }
    return {
      success: false,
      error: err.message || 'Failed to communicate with X API endpoint',
    };
  }
}
