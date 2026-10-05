/**
 * X ChromaBot - ParticipantRow
 * Conversation editor: one voice (account + persona). The dropdown hides accounts chosen elsewhere.
 */

import React from 'react';
import { Trash2 } from 'lucide-react';
import type { ConversationParticipant } from '../../../shared/types.js';
import type { XAccountInfo } from '../../types.js';
import { FIELD_CLASS } from './constants.js';

interface ParticipantRowProps {
  index: number;
  participant: ConversationParticipant;
  accounts: XAccountInfo[];
  /** Account ids chosen by the other rows. */
  taken: string[];
  canRemove: boolean;
  onChange: (fields: Partial<ConversationParticipant>) => void;
  onRemove: () => void;
}

export const ParticipantRow: React.FC<ParticipantRowProps> = ({
  index,
  participant,
  accounts,
  taken,
  canRemove,
  onChange,
  onRemove,
}) => {
  const n = index + 1;
  const known = accounts.some((a) => a.id === participant.accountId);
  return (
    <div
      data-testid="participant-row"
      className="p-3 rounded-lg border border-neutral-200 dark:border-neutral-700 space-y-2"
    >
      <div className="flex items-center gap-2">
        <select
          aria-label={`Participant ${n} account`}
          value={participant.accountId}
          onChange={(e) => onChange({ accountId: e.target.value })}
          className={FIELD_CLASS}
        >
          <option value="">Choose an account…</option>
          {participant.accountId && !known && (
            <option value={participant.accountId}>Removed account ({participant.accountId})</option>
          )}
          {accounts
            .filter((a) => !taken.includes(a.id))
            .map((a) => (
              <option key={a.id} value={a.id} disabled={a.status === 'revoked'}>
                {a.handle ? `@${a.handle}` : 'Unverified account'} · {a.label}
                {a.status === 'revoked' ? ' (disconnected)' : ''}
              </option>
            ))}
        </select>
        <button
          type="button"
          onClick={onRemove}
          disabled={!canRemove}
          aria-label={`Remove participant ${n}`}
          title={canRemove ? 'Remove participant' : 'A conversation needs at least 2 participants'}
          className="p-2 text-neutral-400 hover:text-red-600 rounded-md cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
      <textarea
        aria-label={`Participant ${n} persona`}
        rows={2}
        maxLength={1500}
        value={participant.persona}
        onChange={(e) => onChange({ persona: e.target.value })}
        placeholder="Persona: how this account speaks"
        className={FIELD_CLASS}
      />
    </div>
  );
};
