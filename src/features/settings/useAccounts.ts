/**
 * X ChromaBot - useAccounts
 * Actions on the X accounts campaigns post as. The list itself comes from /api/status
 * (ServerInfo.accounts); every action refreshes it through `refresh`.
 */

import { useState } from 'react';
import {
  completeAccountConnect,
  removeAccount,
  renameAccount,
  startAccountConnect,
  verifyAccount,
} from '../../api/endpoints.js';
import { toast } from '../../components/ui/toastStore.js';
import { useServerInfo } from '../../context/serverInfo.js';

/** Where X sends the browser back after the owner approves (must be registered in the X portal). */
export const OAUTH_CALLBACK_PATH = '/oauth/x/callback';

export interface PendingPin {
  oauthToken: string;
  authorizeUrl: string;
}

export function useAccounts(refresh: () => Promise<void> | void) {
  const { accounts = [] } = useServerInfo();
  const [busy, setBusy] = useState<string | null>(null);
  const [pendingPin, setPendingPin] = useState<PendingPin | null>(null);

  /** Runs one action with a busy marker; API errors are already toasted by the client. */
  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    try {
      await action();
      await refresh();
    } catch {
      // toasted by apiFetch
    } finally {
      setBusy(null);
    }
  };

  /** Primary flow: X's sign-in page, then back to /oauth/x/callback (see useOAuthCallback). */
  const connectWithRedirect = () =>
    run('connect', async () => {
      const callbackUrl = `${window.location.origin}${OAUTH_CALLBACK_PATH}`;
      const r = await startAccountConnect({ mode: 'redirect', callbackUrl });
      window.location.assign(r.authorizeUrl);
    });

  /** Fallback: X shows a PIN that the owner types back here. */
  const startPin = () =>
    run('connect', async () => {
      const r = await startAccountConnect({ mode: 'pin' });
      setPendingPin({ oauthToken: r.oauthToken, authorizeUrl: r.authorizeUrl });
    });

  const submitPin = (pin: string) =>
    run('pin', async () => {
      if (!pendingPin) return;
      const r = await completeAccountConnect({ oauthToken: pendingPin.oauthToken, verifier: pin });
      setPendingPin(null);
      toast.success(`Connected @${r.account.handle}`);
    });

  const verify = (id: string) =>
    run(`verify:${id}`, async () => {
      const r = await verifyAccount(id);
      if (r.valid) toast.success(r.message);
      else toast.error(r.message);
    });

  const rename = (id: string, label: string) =>
    run(`rename:${id}`, async () => {
      await renameAccount(id, label);
    });

  const remove = (id: string) =>
    run(`remove:${id}`, async () => {
      const r = await removeAccount(id);
      if (r.pausedCampaigns.length) {
        toast.info(`Paused: ${r.pausedCampaigns.join(', ')}. Pick another account and resume.`);
      }
    });

  return {
    accounts,
    busy,
    pendingPin,
    cancelPin: () => setPendingPin(null),
    connectWithRedirect,
    startPin,
    submitPin,
    verify,
    rename,
    remove,
  };
}

export type AccountsState = ReturnType<typeof useAccounts>;
