/**
 * X ChromaBot - AccountRow
 * One X account in Settings: @handle, label, status, last verified, and its actions.
 * The default (env-token) account can only be verified.
 */

import React, { useState } from 'react';
import { BadgeCheck, Pencil, Trash2, Check, X } from 'lucide-react';
import { XAccountInfo } from '../../types.js';

interface AccountRowProps {
  account: XAccountInfo;
  busy: string | null;
  onVerify: () => void;
  onRename: (label: string) => void;
  onRequestRemove: () => void;
}

const STATUS_STYLES: Record<XAccountInfo['status'], string> = {
  ok: 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
  unverified:
    'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 border-neutral-200 dark:border-neutral-700',
  revoked:
    'bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800',
};
const STATUS_LABEL: Record<XAccountInfo['status'], string> = {
  ok: 'OK',
  unverified: 'Not verified',
  revoked: 'Disconnected',
};
const ACTION =
  'px-2 py-1 text-[11px] font-semibold rounded-md bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200 transition-colors cursor-pointer inline-flex items-center gap-1 disabled:opacity-50';

export const AccountRow: React.FC<AccountRowProps> = ({
  account,
  busy,
  onVerify,
  onRename,
  onRequestRemove,
}) => {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(account.label);
  const verified = account.lastVerifiedAt
    ? new Date(account.lastVerifiedAt).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'never';

  const saveLabel = () => {
    setEditing(false);
    if (label.trim() && label.trim() !== account.label) onRename(label.trim());
  };

  return (
    <li
      data-testid="account-row"
      data-account-id={account.id}
      className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
    >
      <div className="min-w-0 space-y-0.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-neutral-900 dark:text-neutral-100">
            {account.handle ? `@${account.handle}` : 'Handle unknown (verify)'}
          </span>
          {editing ? (
            <span className="inline-flex items-center gap-1">
              <input
                aria-label="Account label"
                value={label}
                autoFocus
                maxLength={60}
                onChange={(e) => setLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveLabel();
                  if (e.key === 'Escape') setEditing(false);
                }}
                className="px-2 py-0.5 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-xs"
              />
              <button type="button" aria-label="Save label" onClick={saveLabel} className={ACTION}>
                <Check className="w-3 h-3" />
              </button>
              <button
                type="button"
                aria-label="Cancel rename"
                onClick={() => setEditing(false)}
                className={ACTION}
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ) : (
            <span className="text-neutral-500">· {account.label}</span>
          )}
          <span
            className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${STATUS_STYLES[account.status]}`}
            title={account.lastError}
          >
            {STATUS_LABEL[account.status]}
          </span>
        </div>
        <p className="text-[11px] text-neutral-500">
          Last verified: {verified}
          {account.status === 'revoked' && account.lastError ? ` · ${account.lastError}` : ''}
        </p>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          onClick={onVerify}
          disabled={busy === `verify:${account.id}`}
          className={ACTION}
        >
          <BadgeCheck className="w-3 h-3" /> Verify
        </button>
        {!account.isDefault && (
          <>
            <button
              type="button"
              onClick={() => {
                setLabel(account.label);
                setEditing(true);
              }}
              className={ACTION}
            >
              <Pencil className="w-3 h-3" /> Rename
            </button>
            <button
              type="button"
              onClick={onRequestRemove}
              disabled={busy === `remove:${account.id}`}
              className={`${ACTION} text-red-600 dark:text-red-400`}
            >
              <Trash2 className="w-3 h-3" /> Remove
            </button>
          </>
        )}
      </div>
    </li>
  );
};
