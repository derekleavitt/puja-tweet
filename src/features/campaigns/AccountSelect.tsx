/**
 * X ChromaBot - AccountSelect
 * Campaign form: the X account this campaign posts as (Settings, X accounts lists them).
 */

import React from 'react';
import { DEFAULT_ACCOUNT_ID } from '../../types.js';
import { useServerInfo } from '../../context/serverInfo.js';
import { FIELD_CLASS, LABEL_CLASS } from './constants.js';

interface AccountSelectProps {
  value?: string;
  /** The saved account of an existing campaign (undefined while creating). */
  savedValue?: string;
  /** The campaign has (or builds) a reply chain that an account change would restart. */
  hasChain: boolean;
  onChange: (accountId: string) => void;
}

export const AccountSelect: React.FC<AccountSelectProps> = ({
  value,
  savedValue,
  hasChain,
  onChange,
}) => {
  const { accounts = [] } = useServerInfo();
  const selected = value || DEFAULT_ACCOUNT_ID;
  const known = accounts.some((a) => a.id === selected);
  const changed = savedValue !== undefined && selected !== (savedValue || DEFAULT_ACCOUNT_ID);

  return (
    <div className="space-y-1.5">
      <label htmlFor="posts-as" className={LABEL_CLASS}>
        Posts as
      </label>
      <select
        id="posts-as"
        aria-label="Posts as"
        value={selected}
        onChange={(e) => onChange(e.target.value)}
        className={FIELD_CLASS}
      >
        {!known && <option value={selected}>Removed account ({selected})</option>}
        {accounts.map((a) => (
          <option key={a.id} value={a.id} disabled={a.status === 'revoked' && a.id !== selected}>
            {a.handle ? `@${a.handle}` : a.label}
            {a.isDefault ? ' (default)' : a.label !== `@${a.handle}` ? ` · ${a.label}` : ''}
            {a.status === 'revoked' ? ' (disconnected)' : ''}
          </option>
        ))}
      </select>
      <p className="text-[11px] text-neutral-500">
        X only allows replies to posts this account wrote or is mentioned in. Add accounts under
        Settings, X accounts.
      </p>
      {changed && hasChain && (
        <p className="text-[11px] text-amber-700 dark:text-amber-400">
          Changing the account starts a new reply chain (the next reply goes to the target post).
        </p>
      )}
    </div>
  );
};
