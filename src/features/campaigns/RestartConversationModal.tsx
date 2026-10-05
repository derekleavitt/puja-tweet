/**
 * X ChromaBot - RestartConversationModal
 * Starts a new conversation thread for a campaign: a new opening reply (ID/URL + its text), an
 * optional opener handle and the first speaker. Turn count and transcript start over.
 */

import React, { useState } from 'react';
import { X } from 'lucide-react';
import { extractTweetId } from '../../../shared/tweetId.js';
import type { TweetContext } from '../../types.js';
import type { RestartConversationBody } from '../../api/endpoints.js';
import { useServerInfo } from '../../context/serverInfo.js';
import { errorMessage } from '../../lib/errors.js';
import { FIELD_CLASS, LABEL_CLASS } from './constants.js';
import { mentionsHandle } from './useContextForm.js';

interface RestartConversationModalProps {
  context: TweetContext;
  onRestart: (body: RestartConversationBody) => Promise<void>;
  onClose: () => void;
}

export const RestartConversationModal: React.FC<RestartConversationModalProps> = ({
  context,
  onRestart,
  onClose,
}) => {
  const { accounts = [] } = useServerInfo();
  const conv = context.conversation;
  const [target, setTarget] = useState('');
  const [openingPost, setOpeningPost] = useState('');
  const [openerHandle, setOpenerHandle] = useState(conv?.openerHandle ?? '');
  const [first, setFirst] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleOf = (id: string) => accounts.find((a) => a.id === id)?.handle || '';
  const opener = openerHandle.trim().replace(/^@/, '').toLowerCase();
  const speakers = (conv?.participants ?? []).filter((p) => {
    const h = handleOf(p.accountId);
    return h && mentionsHandle(openingPost, h) && h.toLowerCase() !== opener;
  });
  const cleanId = extractTweetId(target);
  const valid = !!cleanId && openingPost.trim().length > 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cleanId || !valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onRestart({
        targetTweetId: cleanId,
        openingPost: openingPost.trim(),
        ...(opener ? { openerHandle: opener } : {}),
        ...(first ? { firstSpeakerAccountId: first } : {}),
      });
      onClose();
    } catch (err) {
      setError(errorMessage(err, 'Could not restart the conversation.'));
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <form
        role="dialog"
        aria-modal="true"
        aria-label="Restart conversation"
        onSubmit={submit}
        className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl max-w-md w-full p-5 shadow-2xl space-y-4 text-xs max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-neutral-900 dark:text-neutral-100">
              Restart conversation
            </h3>
            <p className="text-neutral-500 mt-0.5">
              “{context.name}” starts a new conversation thread. The turn count and transcript start
              over.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1 text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="restart-target" className={LABEL_CLASS}>
            New opening reply (tweet ID/URL)
          </label>
          <input
            id="restart-target"
            type="text"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="Tweet ID or https://x.com/user/status/..."
            className={`${FIELD_CLASS} font-mono`}
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="restart-opening" className={LABEL_CLASS}>
            Opening post text
          </label>
          <textarea
            id="restart-opening"
            rows={3}
            maxLength={1000}
            value={openingPost}
            onChange={(e) => setOpeningPost(e.target.value)}
            placeholder="Paste the text of your opening reply"
            className={FIELD_CLASS}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label htmlFor="restart-opener" className={LABEL_CLASS}>
              Opener handle (optional)
            </label>
            <input
              id="restart-opener"
              type="text"
              maxLength={15}
              value={openerHandle}
              onChange={(e) => setOpenerHandle(e.target.value.replace(/^@/, ''))}
              placeholder="without @"
              className={FIELD_CLASS}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="restart-first" className={LABEL_CLASS}>
              First speaker
            </label>
            <select
              id="restart-first"
              value={first}
              onChange={(e) => setFirst(e.target.value)}
              className={FIELD_CLASS}
            >
              <option value="">Random</option>
              {speakers.map((p) => (
                <option key={p.accountId} value={p.accountId}>
                  @{handleOf(p.accountId)}
                </option>
              ))}
            </select>
          </div>
        </div>

        {error && <p className="text-red-600 dark:text-red-400">{error}</p>}

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!valid || busy}
            className="px-3 py-1.5 rounded-lg font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 cursor-pointer"
          >
            {busy ? 'Restarting…' : 'Restart conversation'}
          </button>
        </div>
      </form>
    </div>
  );
};
