/**
 * Global test setup: point the JSON store at a throwaway temp dir before any
 * module that imports `server/storage.ts` is loaded, so nothing is written into the repo.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll } from 'vitest';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chromabot-test-'));
process.env.DATA_DIR = dataDir;

afterAll(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});
