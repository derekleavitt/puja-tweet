/**
 * Global test setup: point the JSON store at a throwaway temp dir before any
 * module that imports `server/services/index.ts` is loaded; the services use the in-memory store.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll } from 'vitest';

// Never load the developer's .env (auth bypass, real keys) into tests: point dotenv at an empty file.
process.env.DOTENV_CONFIG_PATH = os.devNull;
process.env.DOTENV_CONFIG_QUIET = 'true';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chromabot-test-'));
process.env.DATA_DIR = dataDir;
process.env.STORE = 'memory';

afterAll(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});
