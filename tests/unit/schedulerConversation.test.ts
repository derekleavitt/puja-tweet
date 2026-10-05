import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scheduler } from '../../server/scheduler.js';
import { services } from '../../server/services/index.js';
import { oauth1AccessToken, oauth1RequestToken } from '../../server/twitterClient.js';

vi.mock('../../server/twitterClient.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../server/twitterClient.js')>()),
  oauth1RequestToken: vi.fn(),
  oauth1AccessToken: vi.fn(),
}));

const connect = async (userId: string, handle: string) => {
  vi.mocked(oauth1RequestToken).mockResolvedValueOnce({
    oauthToken: `req-${userId}`,
    oauthTokenSecret: 'rs',
    callbackConfirmed: true,
  });
  vi.mocked(oauth1AccessToken).mockResolvedValueOnce({
    accessToken: `token-${userId}`,
    accessTokenSecret: `secret-${userId}`,
    userId,
    screenName: handle,
  });
  await services.accounts.startConnect('oob');
  return (await services.accounts.completeConnect(`req-${userId}`, '1234')).id;
};

beforeEach(() => {
  vi.stubEnv('CREDENTIALS_ENCRYPTION_KEY', 'd'.repeat(64));
  vi.stubEnv('TWITTER_API_KEY', 'k');
  vi.stubEnv('TWITTER_API_SECRET', 's');
  services.settings.updateSettings({ globalPaused: false });
});
afterEach(() => vi.unstubAllEnvs());

describe('scheduler gating of conversation campaigns', () => {
  it('names the next speaker when it is blocked, and ignores the other participants', async () => {
    const a = await connect('9001', 'ann');
    const b = await connect('9002', 'ben');
    const ctx = services.contexts.createContext({
      name: 'Chat',
      targetTweetId: '1700000000000000001',
      mode: 'conversation',
      enabled: true,
      conversation: {
        participants: [
          { accountId: a, persona: 'x' },
          { accountId: b, persona: 'y' },
        ],
        sharedPrompt: 'p',
        openingPost: 'hi @ann @ben',
        openerHandle: 'owner',
        firstSpeakerAccountId: a,
      },
    });
    expect(scheduler.getBlockedReason(ctx)).toBeUndefined();

    services.rateLimit.setCooldown(10, 'test', b); // not the next speaker: no effect
    expect(scheduler.getBlockedReason(ctx)).toBeUndefined();

    services.rateLimit.setCooldown(10, 'limit', a);
    expect(scheduler.getBlockedReason(ctx)).toMatch(/^Next speaker @ann: X cooldown/);

    services.rateLimit.clearCooldown();
    services.accounts.markRevoked(a, 'revoked');
    expect(scheduler.getBlockedReason(ctx)).toMatch(/^Next speaker @ann: /);
  });
});
