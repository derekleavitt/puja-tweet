/**
 * Global test setup: point the JSON store at a throwaway temp dir before any
 * module that imports `server/services/index.ts` is loaded; the services use the in-memory store.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll } from 'vitest';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chromabot-test-'));
process.env.DATA_DIR = dataDir;
process.env.STORE = 'memory';

afterAll(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});
