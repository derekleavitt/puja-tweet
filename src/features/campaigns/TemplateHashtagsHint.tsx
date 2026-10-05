/**
 * X ChromaBot - TemplateHashtagsHint
 * Shown when the Tweet Text Template itself contains hashtags: offers to move them into the
 * campaign's Hashtags field (where they belong, so evolution and the AI clean-up can manage them).
 */

import React from 'react';
import { extractTemplateHashtags, normaliseCampaignTags } from '../../../shared/hashtags/index.js';

interface TemplateHashtagsHintProps {
  template: string;
  hashtags: string[];
  onMove: (template: string, hashtags: string[]) => void;
}

export const TemplateHashtagsHint: React.FC<TemplateHashtagsHintProps> = ({
  template,
  hashtags,
  onMove,
}) => {
  const moved = extractTemplateHashtags(template);
  if (moved.hashtags.length === 0) return null;

  return (
    <div
      data-testid="template-hashtags-hint"
      className="p-2.5 rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 text-[11px] text-amber-800 dark:text-amber-300 flex items-center justify-between gap-2"
    >
      <span>
        Your template contains hashtags ({moved.hashtags.map((t) => `#${t}`).join(' ')}). Move them
        to the Hashtags field below so they are managed there.
      </span>
      <button
        type="button"
        onClick={() =>
          onMove(moved.template, normaliseCampaignTags([...hashtags, ...moved.hashtags]))
        }
        className="shrink-0 px-2 py-1 rounded-md bg-amber-600 hover:bg-amber-700 text-white font-semibold cursor-pointer"
      >
        Move to Hashtags
      </button>
    </div>
  );
};
