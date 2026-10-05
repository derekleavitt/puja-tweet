/**
 * X ChromaBot - HashtagEvolutionEditor
 * "Evolve hashtags each tweet" settings for the campaign form: toggle, max tags, keep-originals,
 * and what evolution starts from (the campaign's Hashtags field).
 */

import React from 'react';
import { Hash } from 'lucide-react';
import { HashtagEvolutionConfig } from '../../types.js';
import {
  MAX_EVOLVED_TAGS,
  MIN_EVOLVED_TAGS,
  normaliseEvolution,
} from '../../../shared/hashtags/index.js';
import { FIELD_CLASS, LABEL_CLASS } from './constants.js';

interface HashtagEvolutionEditorProps {
  /** The campaign's own hashtags (the Hashtags field), evolution's starting point. */
  hashtags: string[];
  value?: HashtagEvolutionConfig;
  onChange: (value: HashtagEvolutionConfig) => void;
}

const MAX_OPTIONS = Array.from(
  { length: MAX_EVOLVED_TAGS - MIN_EVOLVED_TAGS + 1 },
  (_, i) => MIN_EVOLVED_TAGS + i,
);
const CHECKBOX =
  'mt-0.5 h-4 w-4 rounded border-neutral-300 text-neutral-900 focus:ring-neutral-500';
const TAG_CHIP =
  'px-1.5 py-0.5 rounded bg-teal-50 dark:bg-teal-950/50 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800 font-mono text-[11px]';

export const HashtagEvolutionEditor: React.FC<HashtagEvolutionEditorProps> = ({
  hashtags,
  value,
  onChange,
}) => {
  const cfg = normaliseEvolution(value);
  const update = (fields: Partial<HashtagEvolutionConfig>) => onChange({ ...cfg, ...fields });

  return (
    <div className="p-3 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50/60 dark:bg-neutral-950/40 space-y-2.5">
      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={cfg.enabled}
          onChange={(e) => update({ enabled: e.target.checked })}
          className={CHECKBOX}
        />
        <span className="text-xs text-neutral-700 dark:text-neutral-300">
          <span className="font-semibold flex items-center gap-1.5">
            <Hash className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
            Evolve hashtags each tweet
          </span>
          <span className="block text-[11px] text-neutral-500">
            Each tweet swaps your Hashtags for fresh, related ones that never repeat recently. Off:
            your Hashtags are posted as they are.
          </span>
        </span>
      </label>

      {cfg.enabled && (
        <div className="pl-6 space-y-2.5">
          <div className="flex items-center gap-2">
            <label htmlFor="hashtag-max" className={LABEL_CLASS}>
              Max tags
            </label>
            <select
              id="hashtag-max"
              value={cfg.maxTags}
              onChange={(e) => update({ maxTags: Number(e.target.value) })}
              className={`${FIELD_CLASS} !w-20`}
            >
              {MAX_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>

          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={cfg.keepSeedTags}
              onChange={(e) => update({ keepSeedTags: e.target.checked })}
              className={CHECKBOX}
            />
            <span className="text-xs text-neutral-700 dark:text-neutral-300">
              Always keep my original hashtags
              <span className="block text-[11px] text-neutral-500">
                They count toward Max tags; at least one tag always evolves.
              </span>
            </span>
          </label>

          <div className="text-[11px] text-neutral-500 flex items-center gap-1.5 flex-wrap">
            <span>
              {hashtags.length > 0
                ? 'Evolves from your Hashtags:'
                : 'No Hashtags set: evolves from the AI text or the template theme.'}
            </span>
            {hashtags.map((tag) => (
              <span key={tag} className={TAG_CHIP}>
                #{tag}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
