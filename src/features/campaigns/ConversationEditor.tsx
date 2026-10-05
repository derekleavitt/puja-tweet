/**
 * X ChromaBot - ConversationEditor
 * Campaign form section for conversation mode: cast, shared prompt, opening post, first speaker, length.
 */

import React from 'react';
import { Plus } from 'lucide-react';
import type { ConversationConfig } from '../../../shared/types.js';
import { useServerInfo } from '../../context/serverInfo.js';
import { FIELD_CLASS, LABEL_CLASS } from './constants.js';
import { ParticipantRow } from './ParticipantRow.js';
import {
  MAX_PARTICIPANTS,
  MIN_PARTICIPANTS,
  conversationIssues,
  mentionsHandle,
} from './useContextForm.js';

interface ConversationEditorProps {
  value: ConversationConfig;
  onChange: (fields: Partial<ConversationConfig>) => void;
}

export const ConversationEditor: React.FC<ConversationEditorProps> = ({ value, onChange }) => {
  const { accounts = [] } = useServerInfo();
  const rows = value.participants;
  const handleOf = (id: string) => accounts.find((a) => a.id === id)?.handle || '';
  const opener = (value.openerHandle ?? '').trim().replace(/^@/, '').toLowerCase();
  // Only accounts the opening post @mentions can speak first (X restricts replies to mentions).
  const speakers = rows.filter((p) => {
    const h = handleOf(p.accountId);
    return (
      (h && mentionsHandle(value.openingPost, h) && h.toLowerCase() !== opener) ||
      (p.accountId && p.accountId === value.firstSpeakerAccountId)
    );
  });
  const issues = conversationIssues(value, accounts);
  const setRow = (i: number, fields: Partial<(typeof rows)[number]>) =>
    onChange({ participants: rows.map((p, j) => (j === i ? { ...p, ...fields } : p)) });

  return (
    <div className="space-y-4 p-3 rounded-xl border border-indigo-200 dark:border-indigo-900 bg-indigo-50/30 dark:bg-indigo-950/20">
      <div className="space-y-2">
        <span className={LABEL_CLASS}>
          Participants ({rows.length}/{MAX_PARTICIPANTS})
        </span>
        {rows.map((p, i) => (
          <ParticipantRow
            key={i}
            index={i}
            participant={p}
            accounts={accounts}
            taken={rows.filter((_, j) => j !== i).map((q) => q.accountId)}
            canRemove={rows.length > MIN_PARTICIPANTS}
            onChange={(fields) => setRow(i, fields)}
            onRemove={() => onChange({ participants: rows.filter((_, j) => j !== i) })}
          />
        ))}
        <button
          type="button"
          disabled={rows.length >= MAX_PARTICIPANTS}
          onClick={() => onChange({ participants: [...rows, { accountId: '', persona: '' }] })}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-300 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Plus className="w-3.5 h-3.5" /> Add participant
        </button>
        {rows.length === 2 && (
          <p className="text-[11px] text-neutral-500">With two voices they simply take turns.</p>
        )}
      </div>

      <div className="space-y-1.5">
        <label htmlFor="conv-prompt" className={LABEL_CLASS}>
          Shared prompt (premise &amp; tone)
        </label>
        <textarea
          id="conv-prompt"
          rows={3}
          maxLength={3000}
          value={value.sharedPrompt}
          onChange={(e) => onChange({ sharedPrompt: e.target.value })}
          className={FIELD_CLASS}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="conv-opening" className={LABEL_CLASS}>
          Opening post text
        </label>
        <textarea
          id="conv-opening"
          rows={3}
          maxLength={1000}
          value={value.openingPost}
          onChange={(e) => onChange({ openingPost: e.target.value })}
          placeholder="Paste the text of your opening reply"
          className={FIELD_CLASS}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <label htmlFor="conv-opener" className={LABEL_CLASS}>
            Opener handle
          </label>
          <input
            id="conv-opener"
            type="text"
            maxLength={15}
            value={value.openerHandle ?? ''}
            onChange={(e) => onChange({ openerHandle: e.target.value.replace(/^@/, '') })}
            placeholder="optional, without @"
            className={FIELD_CLASS}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="conv-first" className={LABEL_CLASS}>
            First speaker
          </label>
          <select
            id="conv-first"
            value={value.firstSpeakerAccountId ?? ''}
            onChange={(e) => onChange({ firstSpeakerAccountId: e.target.value || undefined })}
            className={FIELD_CLASS}
          >
            <option value="">Random (among accounts mentioned in the opening post)</option>
            {speakers.map((p) => (
              <option key={p.accountId} value={p.accountId}>
                @{handleOf(p.accountId)}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="conv-turns-mode" className={LABEL_CLASS}>
            Turns
          </label>
          <div className="flex gap-2">
            <select
              id="conv-turns-mode"
              value={value.maxTurns === undefined ? 'unlimited' : 'fixed'}
              onChange={(e) => onChange({ maxTurns: e.target.value === 'fixed' ? 20 : undefined })}
              className={FIELD_CLASS}
            >
              <option value="unlimited">Unlimited</option>
              <option value="fixed">Fixed number</option>
            </select>
            {value.maxTurns !== undefined && (
              <input
                type="number"
                aria-label="Number of turns"
                min={1}
                max={500}
                value={Number.isNaN(value.maxTurns) ? '' : value.maxTurns}
                onChange={(e) => onChange({ maxTurns: e.target.valueAsNumber })}
                className={`${FIELD_CLASS} w-24`}
              />
            )}
          </div>
        </div>
      </div>

      {issues.length > 0 && (
        <ul
          role="alert"
          className="list-disc pl-4 space-y-0.5 text-[11px] text-amber-700 dark:text-amber-400"
        >
          {issues.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
    </div>
  );
};
