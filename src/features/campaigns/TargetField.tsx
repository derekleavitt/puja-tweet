/**
 * X ChromaBot - TargetField
 * Campaign form: target tweet ID or URL, with the cleaned ID and a link to verify it on X.
 */

import React from 'react';
import { ExternalLink } from 'lucide-react';
import { extractTweetId } from '../../../shared/tweetId.js';
import { FIELD_CLASS, LABEL_CLASS } from './constants.js';

interface TargetFieldProps {
  value: string;
  onChange: (value: string) => void;
}

export const TargetField: React.FC<TargetFieldProps> = ({ value, onChange }) => {
  const cleanId = extractTweetId(value);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className={LABEL_CLASS}>Target Tweet ID or URL *</label>
        {cleanId && (
          <a
            href={`https://x.com/i/status/${cleanId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1 font-mono"
          >
            Verify on X <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>
      <input
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
          Numeric tweet ID of the post your automated replies will attach to.
        </p>
      )}
    </div>
  );
};
