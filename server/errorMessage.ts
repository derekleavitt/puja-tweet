/**
 * Narrowing helpers for `catch (err)` (caught values are `unknown`).
 */

/** The `message` of an Error-like value (or a thrown string), '' when there is none. */
export const errorMessage = (err: unknown): string => {
  if (typeof err === 'string') return err;
  const message =
    typeof err === 'object' && err !== null ? (err as { message?: unknown }).message : undefined;
  return typeof message === 'string' ? message : '';
};

/** A string `code` property (e.g. Firebase auth error codes), if present. */
export const errorCode = (err: unknown): string | undefined => {
  const code =
    typeof err === 'object' && err !== null ? (err as { code?: unknown }).code : undefined;
  return typeof code === 'string' ? code : undefined;
};
