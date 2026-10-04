/**
 * X ChromaBot - error helpers
 * Narrowing for `catch (err)` (caught values are `unknown`).
 */

/** The message of an Error-like value (or thrown string), or `fallback` when there is none. */
export function errorMessage(err: unknown, fallback = ''): string {
  if (typeof err === 'string' && err) return err;
  const message =
    typeof err === 'object' && err !== null ? (err as { message?: unknown }).message : undefined;
  return typeof message === 'string' && message ? message : fallback;
}
