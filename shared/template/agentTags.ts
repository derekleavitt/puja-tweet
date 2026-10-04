/**
 * <agent> / <history> template tag helpers (pure).
 */

export const COMBINED_HISTORY_AGENT_REGEX =
  /<history>\s*<agent>([\s\S]*?)<\/agent>\s*<\/history>|<agent>\s*<history>([\s\S]*?)<\/history>\s*<\/agent>|<agent\s+history=["']?true["']?>([\s\S]*?)<\/agent>/gi;
export const STANDALONE_AGENT_REGEX = /<agent>([\s\S]*?)<\/agent>/gi;
const PREVIEW_AGENT_REGEX = /<agent(?:\s+history=["']?true["']?)?>([\s\S]*?)<\/agent>/gi;

export function hasAgentTag(template: string): boolean {
  return /<agent>/i.test(template);
}

export function hasHistoryTag(template: string): boolean {
  return /<history>/i.test(template);
}

/** Remove stray <history> / </history> tags. */
export function stripHistoryTags(text: string): string {
  return text.replace(/<\/?history>/gi, '');
}

/** Replace each <agent> block with a bracketed placeholder (used for non-AI slot previews). */
export function stripAgentTags(text: string, label: string): string {
  return stripHistoryTags(text).replace(
    PREVIEW_AGENT_REGEX,
    (_, inner: string) => `[AI Poetry (${label}): ${inner.trim()}]`,
  );
}
