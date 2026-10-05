/**
 * X ChromaBot - PinConnect
 * PIN fallback for connecting an account: open X's authorize page, sign in as the account to add,
 * then type the PIN X shows.
 */

import React, { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { PendingPin } from './useAccounts.js';

interface PinConnectProps {
  pending: PendingPin;
  busy: boolean;
  onSubmit: (pin: string) => void;
  onCancel: () => void;
}

export const PinConnect: React.FC<PinConnectProps> = ({ pending, busy, onSubmit, onCancel }) => {
  const [pin, setPin] = useState('');
  return (
    <form
      className="p-3 rounded-lg border border-indigo-200 dark:border-indigo-900 bg-indigo-50/60 dark:bg-indigo-950/30 space-y-2 text-xs"
      onSubmit={(e) => {
        e.preventDefault();
        if (pin.trim()) onSubmit(pin.trim());
      }}
    >
      <p className="text-neutral-700 dark:text-neutral-300">
        1.{' '}
        <a
          href={pending.authorizeUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-blue-600 dark:text-blue-400 underline inline-flex items-center gap-1"
        >
          Open X to authorize <ExternalLink className="w-3 h-3" />
        </a>{' '}
        and sign in as the account you want to add, then press Authorize app. 2. Enter the PIN X
        shows:
      </p>
      {pending.altAuthorizeUrl && (
        <p className="text-[11px] text-neutral-500">
          X keeps showing its login screen instead of Authorize app?{' '}
          <a
            href={pending.altAuthorizeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 dark:text-blue-400 underline"
          >
            Try X&apos;s other authorize page
          </a>{' '}
          (same PIN step).
        </p>
      )}
      <div className="flex items-center gap-2">
        <input
          aria-label="PIN from X"
          inputMode="numeric"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          placeholder="PIN"
          className="w-32 px-3 py-1.5 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 font-mono"
        />
        <button
          type="submit"
          disabled={busy || !pin.trim()}
          className="px-3 py-1.5 rounded-lg font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 cursor-pointer"
        >
          Connect
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 rounded-lg text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer"
        >
          Cancel
        </button>
      </div>
    </form>
  );
};
