/**
 * X ChromaBot - account helpers
 * Looking up the account a campaign posts as and naming it in the UI.
 */

import { DEFAULT_ACCOUNT_ID, type XAccountInfo } from '../types.js';

/** The account behind `accountId` (undefined / '' = the default account). */
export const findAccount = (
  accounts: XAccountInfo[] | undefined,
  accountId?: string,
): XAccountInfo | undefined =>
  (accounts ?? []).find((a) => a.id === (accountId || DEFAULT_ACCOUNT_ID));

/** "@handle", or a readable fallback while the handle is unknown. */
export const accountName = (account: XAccountInfo | undefined, accountId?: string): string => {
  if (account?.handle) return `@${account.handle}`;
  if (account?.isDefault || !accountId || accountId === DEFAULT_ACCOUNT_ID) {
    return 'the default account';
  }
  return account ? account.label : 'a removed account';
};
