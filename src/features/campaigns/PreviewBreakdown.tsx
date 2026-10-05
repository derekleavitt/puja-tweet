/**
 * X ChromaBot - PreviewBreakdown
 * One line under the campaign preview explaining its hashtags: where the tag block came from and
 * what was done to any hashtags the AI wrote.
 */

import React from 'react';
import { DropTextBreakdown } from '../../types.js';

const tags = (list?: string[]) => (list ?? []).map((t) => `#${t}`).join(' ');

const SEED_LABEL: Record<NonNullable<DropTextBreakdown['seedSource']>, string> = {
  campaign: 'your Hashtags',
  previous: 'the last post',
  ai: "the AI's tags",
  theme: 'the template theme',
};

/** The breakdown as short phrases ('' parts dropped). */
function describeBreakdown(b: DropTextBreakdown): string[] {
  const parts: string[] = [];
  if (b.tagSource === 'campaign') parts.push(`Your Hashtags: ${tags(b.hashtags)}`);
  if (b.tagSource === 'evolved') {
    const from = b.seedSource ? ` (from ${SEED_LABEL[b.seedSource]})` : '';
    const folded = b.foldedAiTags?.length ? `, AI's tags mixed in: ${tags(b.foldedAiTags)}` : '';
    parts.push(`Evolved: ${tags(b.hashtags)}${from}${folded}`);
  }
  if (b.removedAiHashtags?.length) parts.push(`Removed from AI text: ${tags(b.removedAiHashtags)}`);
  if (b.dehashedAiHashtags?.length)
    parts.push(`Made plain words: ${b.dehashedAiHashtags.join(' ')}`);
  if (b.removedDuplicateTags?.length)
    parts.push(`Duplicates removed: ${tags(b.removedDuplicateTags)}`);
  if (b.droppedTags?.length) parts.push(`Dropped to fit 280: ${tags(b.droppedTags)}`);
  return parts;
}

export const PreviewBreakdown: React.FC<{ breakdown?: DropTextBreakdown }> = ({ breakdown }) => {
  if (!breakdown) return null;
  const parts = describeBreakdown(breakdown);
  if (parts.length === 0) return null;
  return (
    <p data-testid="preview-breakdown" className="text-[11px] text-neutral-500 font-mono">
      {parts.join(' · ')}
    </p>
  );
};
