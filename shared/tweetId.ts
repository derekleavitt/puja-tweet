/**
 * Tweet ID parsing shared by UI validation and server cleaning.
 */

/**
 * Extract a numeric tweet ID from a raw ID or a full twitter.com / x.com status URL.
 * Returns null when the input contains neither.
 */
export function extractTweetId(input: string): string | null {
  const trimmed = input.trim();
  const urlMatch = trimmed.match(/(?:twitter\.com|x\.com)\/[^/]+\/status\/(\d+)/i);
  if (urlMatch && urlMatch[1]) return urlMatch[1];
  const digitMatch = trimmed.match(/\b\d{10,25}\b/);
  if (digitMatch) return digitMatch[0];
  return null;
}
