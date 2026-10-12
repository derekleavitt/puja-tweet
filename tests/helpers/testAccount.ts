/**
 * A connected X account for tests that post live. There is no built-in default account any more:
 * every campaign posts as a connected account, so tests connect one and give it to every single
 * campaign that has none (the existing ones and those created later), which is what the removed
 * default account used to be. App keys and the encryption key are stubbed for the test.
 */

import { vi } from 'vitest';
import type { Services } from '../../server/services/index.js';

export const TEST_ACCOUNT = {
  id: 'acct_1000',
  userId: '1000',
  handle: 'tester',
  accessToken: 'test-access-token',
  accessTokenSecret: 'test-access-secret',
};

export async function useTestAccount(svc: Services, account = TEST_ACCOUNT): Promise<string> {
  if (!process.env.CREDENTIALS_ENCRYPTION_KEY) {
    vi.stubEnv('CREDENTIALS_ENCRYPTION_KEY', 'f'.repeat(64));
  }
  if (!process.env.TWITTER_API_KEY) vi.stubEnv('TWITTER_API_KEY', 'test-consumer-key');
  if (!process.env.TWITTER_API_SECRET) vi.stubEnv('TWITTER_API_SECRET', 'test-consumer-secret');
  await svc.accounts.storeConnected({
    userId: account.userId,
    screenName: account.handle,
    accessToken: account.accessToken,
    accessTokenSecret: account.accessTokenSecret,
  });
  for (const c of svc.contexts.getContexts()) {
    if (c.mode !== 'conversation' && !c.accountId) {
      svc.contexts.patchContext(c.id, { accountId: account.id });
    }
  }
  const create = svc.contexts.createContext.bind(svc.contexts);
  svc.contexts.createContext = (data) =>
    create(
      data.mode === 'conversation' || 'accountId' in data
        ? data
        : { ...data, accountId: account.id },
    );
  return account.id;
}
