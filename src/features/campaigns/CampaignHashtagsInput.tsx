/**
 * X ChromaBot - CampaignHashtagsInput
 * The campaign's own hashtags, kept outside the Tweet Text Template. They are added after the
 * tweet text on every post (or are the starting point when hashtag evolution is on).
 */

import React, { useState } from 'react';
import { Hash, X } from 'lucide-react';
import { MAX_CAMPAIGN_TAGS, normaliseCampaignTags } from '../../../shared/hashtags/index.js';
import { FIELD_CLASS, LABEL_CLASS } from './constants.js';

interface CampaignHashtagsInputProps {
  value?: string[];
  onChange: (value: string[]) => void;
}

const TAG_CHIP =
  'px-1.5 py-0.5 rounded bg-teal-50 dark:bg-teal-950/50 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800 font-mono text-[11px] inline-flex items-center gap-1';

/** "#love, devotion #Muse" -> ['love', 'devotion', 'Muse'] */
const splitTags = (raw: string) => raw.split(/[\s,]+/).map((t) => t.replace(/^#+/, ''));

export const CampaignHashtagsInput: React.FC<CampaignHashtagsInputProps> = ({
  value,
  onChange,
}) => {
  const tags = value ?? [];
  const [draft, setDraft] = useState('');
  const full = tags.length >= MAX_CAMPAIGN_TAGS;

  const commit = () => {
    if (!draft.trim()) return;
    onChange(normaliseCampaignTags([...tags, ...splitTags(draft)]));
    setDraft('');
  };

  return (
    <div className="space-y-1.5">
      <label htmlFor="campaign-hashtags" className={`${LABEL_CLASS} flex items-center gap-1.5`}>
        <Hash className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
        Hashtags
      </label>
      <div className="flex items-center gap-1.5 flex-wrap" data-testid="campaign-hashtags">
        {tags.map((tag) => (
          <span key={tag} className={TAG_CHIP}>
            #{tag}
            <button
              type="button"
              onClick={() => onChange(tags.filter((t) => t !== tag))}
              title={`Remove #${tag}`}
              className="cursor-pointer hover:text-red-600"
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
      </div>
      <input
        id="campaign-hashtags"
        value={draft}
        disabled={full}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Backspace' && !draft && tags.length > 0) {
            onChange(tags.slice(0, -1));
          }
        }}
        onBlur={commit}
        placeholder={full ? `Up to ${MAX_CAMPAIGN_TAGS} hashtags` : 'Add a hashtag and press Enter'}
        className={FIELD_CLASS}
      />
      <p className="text-[11px] text-neutral-500">
        Added after the tweet text on every post. Keep hashtags out of the template; the AI is told
        not to write its own.
      </p>
    </div>
  );
};
