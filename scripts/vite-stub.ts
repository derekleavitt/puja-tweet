/**
 * Production-bundle stand-in for `vite`. server/index.ts imports createServer statically,
 * but only calls it outside production, so the real package is kept out of the server bundle.
 */
export const createServer = (): never => {
  throw new Error('Vite dev server is not available in the production bundle');
};
