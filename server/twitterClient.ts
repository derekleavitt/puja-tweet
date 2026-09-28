/**
 * Twitter / X API v2 Client
 * Supports:
 * 1. OAuth 1.0a User Context (Permanent API Key, API Secret, Access Token, Access Token Secret)
 * 2. OAuth 2.0 User Context (Client ID, Client Secret, Access Token, Refresh Token with auto-renewal)
 * 3. OAuth 2.0 Bearer Token
 */

import crypto from 'crypto';

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
}

export interface TweetResponse {
  success: boolean;
  tweetId?: string;
  text?: string;
  replyTo?: string;
  url?: string;
  error?: string;
  rawResponse?: any;
  simulated?: boolean;
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
      url: `https://x.com/i/status/${fakeTweetId}`,
      simulated: true,
      rawResponse: {
        data: { id: fakeTweetId, text: options.text },
        mode: isDryRun ? 'dry_run_simulation' : 'no_user_credentials_simulation',
      },
    };
  }

  const endpoint = 'https://api.x.com/2/tweets';
  const bodyPayload: Record<string, any> = {
    text: options.text,
  };

  if (options.replyToTweetId) {
    bodyPayload.reply = {
      in_reply_to_tweet_id: options.replyToTweetId,
    };
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
      }
      return {
        success: false,
        error: errorMsg,
        rawResponse: data,
      };
    }

    const postedTweetId = data?.data?.id;
    return {
      success: true,
      tweetId: postedTweetId,
      text: data?.data?.text || options.text,
      replyTo: options.replyToTweetId,
      url: postedTweetId ? `https://x.com/i/status/${postedTweetId}` : undefined,
      rawResponse: data,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Failed to communicate with X API endpoint',
    };
  }
}
