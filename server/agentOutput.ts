/**
 * Post-processing of generated `<agent>` text (pure): output clean-up and the shaping options the
 * drop composer passes in (hashtag rules + length budget, see docs/hashtags.md).
 */

import type { ShapedAgentText } from '../shared/hashtags/agentText.js';

/** How the composer wants each `<agent>` text shaped (hashtags, length budget). */
export interface AgentTextOptions {
  /** Room for this AI text (weighted chars) after the template's static text and tag block. */
  maxLength?: number;
  /** Room without the tag block: a complete sentence up to here beats a mid-sentence cut. */
  hardMaxLength?: number;
  /** Extra instruction appended to the directive (e.g. "do not write hashtags"). */
  directive?: string;
  /** Applies the hashtag rules to a raw draft (see `shapeAgentText`). */
  shape?: (text: string) => ShapedAgentText;
  /** Receives every finished AI text (for the preview breakdown). */
  onText?: (result: { text: string; shaped: ShapedAgentText; droppedTail: string[] }) => void;
}

export const plainShape = (text: string): ShapedAgentText => ({
  body: text,
  tail: [],
  lifted: [],
  dehashed: [],
  removed: [],
});

/** Strip accidental enclosing quotes and markdown fences from model output. */
export function cleanAgentOutput(raw: string): string {
  let text = raw.trim();
  if (text.startsWith('"') && text.endsWith('"') && text.length > 2) {
    text = text.substring(1, text.length - 1).trim();
  }
  if (text.startsWith('“') && text.endsWith('”') && text.length > 2) {
    text = text.substring(1, text.length - 1).trim();
  }
  return text
    .replace(/^```[a-z]*\n?/i, '')
    .replace(/\n?```$/i, '')
    .trim();
}

/** Removes a leading "Sunset Copper (#C03F0B) —" style header the model may echo. */
export function stripColorHeader(text: string): string {
  return text.replace(/^[^\n()#]{2,40}\(#[0-9a-f]{3,8}\)\s*[—–:-]\s*/i, '').trim();
}
