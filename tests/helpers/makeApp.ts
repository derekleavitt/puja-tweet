/**
 * Builds the API app for tests against the in-memory services and scheduler.
 * All X traffic is stubbed by the test files via `vi.mock('../../server/twitterClient.js')`.
 * Auth is disabled by default; pass a verifier + allow-list to exercise SEC-2 auth.
 */

import { createApp } from '../../server/app.js';
import type { TokenVerifier } from '../../server/middleware/auth.js';
import { scheduler } from '../../server/scheduler.js';
import { dropService } from '../../server/services/dropService.js';
import { services } from '../../server/services/index.js';

export interface MakeAppOptions {
  verifyToken?: TokenVerifier;
  authorizedEmails?: string[];
}

export const makeApp = (options?: MakeAppOptions) =>
  options
    ? createApp({
        services,
        drops: dropService,
        scheduler,
        verifyToken: options.verifyToken,
        authorizedEmails: options.authorizedEmails,
      })
    : createApp({ services, scheduler, drops: dropService, authDisabled: true });

export { services };
