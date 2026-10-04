/**
 * post-drop CLI entry point: `tsx scripts/post-drop.ts [--context <id>] [--slot morning|evening|auto]
 * [--dry-run | --live] [--force]`. All logic lives in postDropCli.ts and dropService.
 */

import 'dotenv/config';
import { dropService } from '../server/services/dropService.js';
import { services } from '../server/services/index.js';
import { parseArgs, runPostDrop } from './postDropCli.js';

runPostDrop(parseArgs(process.argv.slice(2)), { drops: dropService, services })
  .then(async (code) => {
    await services.flush();
    process.exitCode = code;
  })
  .catch((err) => {
    console.error('Fatal execution error:', err);
    process.exit(1);
  });
