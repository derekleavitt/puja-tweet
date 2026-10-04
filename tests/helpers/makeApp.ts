/**
 * Builds the API app for tests against the real (temp-dir backed) storage and scheduler.
 * All X traffic is stubbed by the test files via `vi.mock('../../server/twitterClient.js')`.
 * Central place to add shared deps such as an auth verifier stub.
 */

import { createApp } from '../../server/app.js';
import { scheduler } from '../../server/scheduler.js';
import { storage } from '../../server/storage.js';

export const makeApp = () => createApp({ storage, scheduler });

export { storage };
