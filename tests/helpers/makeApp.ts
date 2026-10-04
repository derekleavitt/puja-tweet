/**
 * Builds the API app for tests against the real (temp-dir backed) storage and scheduler.
 * All X traffic is stubbed by the test files via `vi.mock('../../server/twitterClient.js')`.
 * Auth is disabled by default; pass a verifier + allow-list to exercise SEC-2 auth.
 */

import { createApp } from '../../server/app.js';
import type { TokenVerifier } from '../../server/middleware/auth.js';
import { scheduler } from '../../server/scheduler.js';
import { storage } from '../../server/storage.js';

export interface MakeAppOptions {
  verifyToken?: TokenVerifier;
  authorizedEmails?: string[];
}

export const makeApp = (options?: MakeAppOptions) =>
  options
    ? createApp({
        storage,
        scheduler,
        verifyToken: options.verifyToken,
        authorizedEmails: options.authorizedEmails,
      })
    : createApp({ storage, scheduler, authDisabled: true });

export { storage };
