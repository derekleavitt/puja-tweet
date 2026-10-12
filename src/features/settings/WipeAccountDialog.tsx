/**
 * X ChromaBot - WipeAccountDialog
 * Confirms "delete all content" of one X account: says exactly what goes and how long it takes,
 * and only enables Start once the owner typed the account's @handle.
 */

import React, { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { XAccountInfo } from '../../types.js';

interface WipeAccountDialogProps {
  account: XAccountInfo;
  /** Campaigns that post as this account (they are paused first). */
  campaigns: string[];
  /** Global dry run is on: the job only counts. */
  simulate: boolean;
  onStart: (confirm: string) => void;
  onCancel: () => void;
}

export const WipeAccountDialog: React.FC<WipeAccountDialogProps> = ({
  account,
  campaigns,
  simulate,
  onStart,
  onCancel,
}) => {
  const [typed, setTyped] = useState('');
  const handle = account.handle;
  const matches = typed.trim().replace(/^@/, '').toLowerCase() === handle.toLowerCase();

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={`Delete all content of @${handle}`}
        className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl max-w-md w-full p-5 shadow-2xl space-y-3 text-xs"
      >
        <div className="flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-red-500" />
          <div className="space-y-2 text-neutral-600 dark:text-neutral-400">
            <h3 className="text-sm font-bold text-neutral-900 dark:text-neutral-100">
              Delete all content of @{handle}?
            </h3>
            {simulate ? (
              <p className="text-amber-700 dark:text-amber-400 font-medium">
                Global Dry Run is on: this only counts what would be deleted. Nothing is removed.
              </p>
            ) : (
              <p className="text-red-600 dark:text-red-400 font-medium">This cannot be undone.</p>
            )}
            <ul className="list-disc pl-4 space-y-0.5">
              <li>Every post, reply and quote of @{handle} is deleted.</li>
              <li>Every retweet is undone and every like removed.</li>
              <li>
                X allows about 50 of each per 15 minutes (likes also 1,000 a day), so a big account
                takes hours. It runs in the background; you can cancel it here.
              </li>
              <li>
                X lists the newest ~3,200 posts at a time; the job repeats until none are left.
                Reading them may count toward your X plan's read limits.
              </li>
              {!simulate && campaigns.length > 0 && (
                <li>These campaigns are paused first: {campaigns.join(', ')}.</li>
              )}
            </ul>
          </div>
        </div>
        <label className="block space-y-1">
          <span className="font-semibold text-neutral-700 dark:text-neutral-300">
            Type @{handle} to confirm
          </span>
          <input
            aria-label="Type the handle to confirm"
            value={typed}
            autoFocus
            onChange={(e) => setTyped(e.target.value)}
            placeholder={`@${handle}`}
            className="w-full px-2.5 py-1.5 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 font-mono"
          />
        </label>
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 rounded-lg text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!matches}
            onClick={() => onStart(typed)}
            className="px-3 py-1.5 rounded-lg font-semibold text-white bg-red-600 hover:bg-red-700 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {simulate ? 'Count content' : 'Delete everything'}
          </button>
        </div>
      </div>
    </div>
  );
};
