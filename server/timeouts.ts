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

export function isTimeoutError(err: any): boolean {
  return err?.name === 'TimeoutError' || err?.name === 'AbortError';
}
