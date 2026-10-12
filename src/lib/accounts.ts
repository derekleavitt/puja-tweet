/**
 * X ChromaBot - account helpers
 * Looking up the connected account a campaign posts as and naming it in the UI.
 */

import type { XAccountInfo } from '../types.js';

/** The connected account behind `accountId` (undefined when none is picked or it is gone). */
export const findAccount = (
  accounts: XAccountInfo[] | undefined,
  accountId?: string,
): XAccountInfo | undefined =>
  accountId ? (accounts ?? []).find((a) => a.id === accountId) : undefined;

/** "@handle", or a readable fallback while the handle is unknown. */
export const accountName = (account: XAccountInfo | undefined, accountId?: string): string => {
  if (account?.handle) return `@${account.handle}`;
  if (!accountId) return 'no account (pick one)';
  return account ? account.label : 'a removed account';
};
