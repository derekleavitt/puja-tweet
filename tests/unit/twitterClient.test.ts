import { describe, expect, it } from 'vitest';
import { generateOAuth1Header, parseRateLimitHeaders } from '../../server/twitterClient.js';

describe('generateOAuth1Header', () => {
  // Known vector from X's "Creating a signature" documentation. Nonce and timestamp are
  // injected through the existing extraParams argument, so no source seam is needed.
  it('matches the documented signature for fixed nonce and timestamp', () => {
    const header = generateOAuth1Header(
      'POST',
      'https://api.twitter.com/1/statuses/update.json',
      {
        apiKey: 'xvz1evFS4wEEPTGEFPHBog',
        apiSecret: 'kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw',
        accessToken: '370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb',
        accessTokenSecret: 'LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE',
      },
      {
        oauth_nonce: 'kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg',
        oauth_timestamp: '1318622958',
        include_entities: 'true',
        status: 'Hello Ladies + Gentlemen, a signed OAuth request!',
      },
    );

    expect(header.startsWith('OAuth ')).toBe(true);
    expect(header).toContain('oauth_signature="tnnArxj06cWHq44gCs1OSKk%2FjLY%3D"');
    expect(header).toContain('oauth_consumer_key="xvz1evFS4wEEPTGEFPHBog"');
    expect(header).toContain('oauth_nonce="kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg"');
    expect(header).toContain('oauth_timestamp="1318622958"');
    expect(header).not.toContain('include_entities');
    expect(header).not.toContain('status=');
  });
});

describe('parseRateLimitHeaders', () => {
  it('parses every known header to numbers', () => {
    const parsed = parseRateLimitHeaders(
      new Headers({
        'x-rate-limit-limit': '300',
        'x-rate-limit-remaining': '42',
        'x-rate-limit-reset': '1700000000',
        'x-app-limit-24hour-limit': '1500',
        'x-user-limit-24hour-limit': '100',
        'retry-after': '60',
      }),
    );
    expect(parsed).toEqual({
      limit: 300,
      remaining: 42,
      reset: 1700000000,
      appDailyLimit: 1500,
      userDailyLimit: 100,
      retryAfter: 60,
    });
  });

  it('leaves missing headers undefined', () => {
    const parsed = parseRateLimitHeaders(new Headers({ 'x-rate-limit-remaining': '0' }));
    expect(parsed.remaining).toBe(0);
    expect(parsed.limit).toBeUndefined();
    expect(parsed.retryAfter).toBeUndefined();
  });
});
