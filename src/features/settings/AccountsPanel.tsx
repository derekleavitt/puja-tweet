/**
 * X ChromaBot - AccountsPanel
 * Settings: the X accounts campaigns can post as. Connect (redirect, or PIN), verify, rename,
 * remove. Each campaign picks one of these in its form ("Posts as").
 */

import React, { useState } from 'react';
import { Users, Plus } from 'lucide-react';
import { TweetContext, XAccountInfo } from '../../types.js';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog.js';
import { AccountRow } from './AccountRow.js';
import { PinConnect } from './PinConnect.js';
import { OAUTH_CALLBACK_PATH, useAccounts } from './useAccounts.js';

interface AccountsPanelProps {
  contexts: TweetContext[];
  refresh: () => Promise<void> | void;
}

export const AccountsPanel: React.FC<AccountsPanelProps> = ({ contexts, refresh }) => {
  const state = useAccounts(refresh);
  const [removing, setRemoving] = useState<XAccountInfo | null>(null);
  const callbackUrl = `${window.location.origin}${OAUTH_CALLBACK_PATH}`;
  const affected = removing ? contexts.filter((c) => c.accountId === removing.id) : [];

  return (
    <section
      aria-label="X accounts"
      className="border border-neutral-200 dark:border-neutral-800 rounded-xl p-5 bg-white dark:bg-neutral-900 space-y-3 shadow-xs"
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <span className="text-xs font-bold uppercase tracking-wider text-neutral-700 dark:text-neutral-300 flex items-center gap-2">
          <Users className="w-4 h-4 text-indigo-500" />X accounts
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={state.startPin}
            disabled={state.busy === 'connect'}
            className="text-[11px] text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200 underline cursor-pointer"
          >
            Use a PIN instead
          </button>
          <button
            type="button"
            onClick={state.connectWithRedirect}
            disabled={state.busy === 'connect'}
            className="px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 rounded-lg transition-colors cursor-pointer inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5" /> Connect account
          </button>
        </div>
      </div>

      <p className="text-xs text-neutral-500 leading-relaxed">
        Each campaign posts as one of these accounts. X authorizes the account you are signed in to
        on x.com in this browser: switch to the account you want to add on x.com first (account
        menu, bottom left), then press Connect account. One-time setup in the X developer portal:
        app permissions <b>Read and Write</b>, User authentication settings on, callback URL{' '}
        <code className="font-mono text-[11px] px-1 rounded bg-neutral-100 dark:bg-neutral-800">
          {callbackUrl}
        </code>
        .
      </p>

      {state.pendingPin && (
        <PinConnect
          pending={state.pendingPin}
          busy={state.busy === 'pin'}
          onSubmit={state.submitPin}
          onCancel={state.cancelPin}
        />
      )}

      <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
        {state.accounts.map((account) => (
          <AccountRow
            key={`${account.id}:${account.label}`}
            account={account}
            busy={state.busy}
            onVerify={() => state.verify(account.id)}
            onRename={(label) => state.rename(account.id, label)}
            onRequestRemove={() => setRemoving(account)}
          />
        ))}
      </ul>

      {removing && (
        <ConfirmDialog
          title={`Remove @${removing.handle}?`}
          message={
            affected.length
              ? `These campaigns post as this account and will be paused: ${affected.map((c) => c.name).join(', ')}. Pick another account for them, then resume.`
              : 'No campaign posts as this account. Its tokens are deleted from this app (revoke the app on x.com to fully disconnect).'
          }
          confirmLabel="Remove"
          destructive
          onConfirm={() => {
            const id = removing.id;
            setRemoving(null);
            void state.remove(id);
          }}
          onCancel={() => setRemoving(null)}
        />
      )}
    </section>
  );
};
