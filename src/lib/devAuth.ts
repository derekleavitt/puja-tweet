/**
 * X ChromaBot - Dev-only auth bypass (for automated browser tests).
 * Active only in `vite dev` (import.meta.env.DEV) with VITE_AUTH_DISABLED=true. In production builds
 * import.meta.env.DEV is statically false, so the bypass and its marker are tree-shaken away
 * (CI greps dist/ for DEV_AUTH_MARKER).
 */

import type { User } from 'firebase/auth';
import { OWNER_EMAIL } from '../../shared/owner.js';

export const DEV_AUTH_MARKER = 'dev-auth-bypass';

/** Written inline (not via a helper) so the bundler folds it to `false` and drops the code below. */
export const DEV_AUTH_BYPASS: boolean =
  import.meta.env.DEV && import.meta.env.VITE_AUTH_DISABLED === 'true';

/** Minimal stand-in for the signed-in owner; never leaves the browser. */
export function devOwnerUser(): User {
  return { uid: DEV_AUTH_MARKER, email: OWNER_EMAIL } as User;
}
