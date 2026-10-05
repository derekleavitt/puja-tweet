/**
 * X ChromaBot - CardConversation
 * Conversation-mode body of a campaign card: the cast, whose turn is next, the shared prompt and
 * Restart (prominent when the conversation finished; Resume continues it for another round).
 */

import React, { useState } from 'react';
import { roundTurns } from '../../../shared/conversationRound.js';
import { RotateCcw } from 'lucide-react';
import type { TweetContext } from '../../types.js';
import type { RestartConversationBody } from '../../api/endpoints.js';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog.js';
import { useServerInfo } from '../../context/serverInfo.js';
import { speakerLabel } from './useCampaignPreview.js';
import { RestartConversationModal } from './RestartConversationModal.js';

interface CardConversationProps {
  context: TweetContext;
  onRestart: (body: RestartConversationBody) => Promise<void>;
}

export const CardConversation: React.FC<CardConversationProps> = ({ context, onRestart }) => {
  const { accounts } = useServerInfo();
  const [confirming, setConfirming] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const conv = context.conversation;
  const state = context.conversationState;
  const finished = !!context.autoPausedReason?.startsWith('Conversation finished');
  const cast = (conv?.participants ?? []).map((p) => speakerLabel(accounts, p.accountId));
  const turn = (state?.turnCount ?? 0) + 1;
  const max = conv?.maxTurns;
  const resumedRound = (state?.roundStartTurn ?? 0) > 0;
  const turnLabel = !max
    ? `Turn ${turn}`
    : resumedRound
      ? `Turn ${turn} (${roundTurns(state) + 1}/${max} this round)`
      : `Turn ${turn}/${max}`;

  return (
    <div data-testid="card-conversation" className="space-y-2 text-xs">
      <p data-testid="conversation-cast" className="text-neutral-600 dark:text-neutral-400">
        Cast:{' '}
        <span className="font-semibold text-neutral-900 dark:text-neutral-100">
          {cast.join(' · ')}
        </span>
      </p>
      {state && !finished && (
        <p data-testid="conversation-next" className="text-neutral-600 dark:text-neutral-400">
          Next:{' '}
          <span className="font-semibold text-neutral-900 dark:text-neutral-100">
            {speakerLabel(accounts, state.nextSpeakerAccountId)} · {turnLabel}
          </span>
        </p>
      )}
      {conv?.sharedPrompt && (
        <div>
          <span className="text-[10px] uppercase font-mono text-neutral-400">Shared prompt:</span>
          <div
            data-testid="conversation-prompt"
            className="mt-1 p-2 rounded-md bg-neutral-100/70 dark:bg-neutral-800/80 text-[11px] text-neutral-700 dark:text-neutral-300 break-words line-clamp-3"
          >
            {conv.sharedPrompt}
          </div>
        </div>
      )}
      {finished && (
        <p
          data-testid="conversation-finished"
          className="p-2 rounded-lg text-[11px] bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800"
        >
          {context.autoPausedReason?.replace(/\.$/, '')}. Resume to continue this thread for{' '}
          {max ?? 'more'} more turns, or Restart to begin a new thread.
        </p>
      )}
      <button
        type="button"
        onClick={() => (finished ? setModalOpen(true) : setConfirming(true))}
        title="Start a new conversation thread"
        className={
          finished
            ? 'px-2.5 py-1 font-semibold rounded-md text-white bg-indigo-600 hover:bg-indigo-700 inline-flex items-center gap-1.5 cursor-pointer'
            : 'px-2 py-1 font-medium rounded-md text-neutral-600 dark:text-neutral-300 border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 inline-flex items-center gap-1.5 cursor-pointer'
        }
      >
        <RotateCcw className="w-3 h-3" />
        Restart
      </button>

      {confirming && (
        <ConfirmDialog
          title="Restart conversation?"
          message="Restarting starts a new conversation thread. The turn count and transcript start over."
          confirmLabel="Continue"
          onConfirm={() => {
            setConfirming(false);
            setModalOpen(true);
          }}
          onCancel={() => setConfirming(false)}
        />
      )}
      {modalOpen && (
        <RestartConversationModal
          context={context}
          onRestart={onRestart}
          onClose={() => setModalOpen(false)}
        />
      )}
    </div>
  );
};
