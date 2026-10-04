/**
 * Network timeout helpers shared by the X and Gemini clients.
 */

export const getXTimeoutMs = (): number => {
  const n = parseInt(process.env.X_TIMEOUT_MS || '', 10);
  return n > 0 ? n : 15000;
};

export const getGeminiTimeoutMs = (): number => {
  const n = parseInt(process.env.GEMINI_TIMEOUT_MS || '', 10);
  return n > 0 ? n : 12000;
};

export function isTimeoutError(err: unknown): boolean {
  const name =
    typeof err === 'object' && err !== null ? (err as { name?: unknown }).name : undefined;
  return name === 'TimeoutError' || name === 'AbortError';
}
