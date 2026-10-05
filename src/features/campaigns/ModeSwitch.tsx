/**
 * X ChromaBot - ModeSwitch
 * Campaign form: segmented control between a single posting account and a multi-account
 * conversation, plus the conversation-mode target field.
 */

import React from 'react';
import { extractTweetId } from '../../../shared/tweetId.js';
import { FIELD_CLASS, LABEL_CLASS } from './constants.js';

type Mode = 'single' | 'conversation';

interface ModeSwitchProps {
  value: Mode;
  onChange: (mode: Mode) => void;
}

const OPTIONS: { id: Mode; label: string }[] = [
  { id: 'single', label: 'Single account' },
  { id: 'conversation', label: 'Conversation' },
];

export const ModeSwitch: React.FC<ModeSwitchProps> = ({ value, onChange }) => (
  <div className="space-y-1.5">
    <span id="campaign-mode-label" className={LABEL_CLASS}>
      Mode
    </span>
    <div
      role="radiogroup"
      aria-labelledby="campaign-mode-label"
      className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-neutral-100 dark:bg-neutral-800"
    >
      {OPTIONS.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={`px-3 py-1.5 rounded-md cursor-pointer transition-colors ${
            value === o.id
              ? 'bg-white dark:bg-neutral-700 text-neutral-900 dark:text-neutral-100 font-semibold shadow-xs'
              : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  </div>
);

interface OpeningReplyFieldProps {
  value: string;
  onChange: (value: string) => void;
}

/** Conversation mode's variant of TargetField: the owner's own opening reply is the chain root. */
export const OpeningReplyField: React.FC<OpeningReplyFieldProps> = ({ value, onChange }) => {
  const cleanId = extractTweetId(value);
  return (
    <div className="space-y-1.5">
      <label htmlFor="opening-reply" className={LABEL_CLASS}>
        Opening reply (tweet ID/URL) *
      </label>
      <input
        id="opening-reply"
        type="text"
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Tweet ID or https://x.com/user/status/..."
        className={`${FIELD_CLASS} font-mono`}
      />
      {cleanId && cleanId !== value.trim() ? (
        <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-mono">
          ✓ Clean ID detected: {cleanId}
        </p>
      ) : (
        <p className="text-[11px] text-neutral-500">
          Post the first reply yourself, @mentioning the accounts, then paste it here.
        </p>
      )}
    </div>
  );
};
