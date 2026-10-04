/**
 * JSON-file persistence (`<DATA_DIR>/bot-store.json`), the original storage behaviour.
 */

import fs from 'fs';
import path from 'path';
import { createDefaultState, normalizeState } from './defaults.js';
import type { BotState, Store } from './Store.js';

export const defaultDataDir = (): string =>
  process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve(process.cwd(), 'data');

export class JsonFileStore implements Store {
  private readonly dataDir: string;
  private readonly file: string;

  constructor(dataDir: string = defaultDataDir()) {
    this.dataDir = dataDir;
    this.file = path.join(dataDir, 'bot-store.json');
  }

  async load(): Promise<BotState> {
    try {
      if (fs.existsSync(this.file)) {
        return normalizeState(JSON.parse(await fs.promises.readFile(this.file, 'utf-8')));
      }
    } catch (err) {
      console.warn('[Store] Could not read bot store file, using defaults:', err);
    }
    return createDefaultState();
  }

  async save(state: BotState): Promise<void> {
    const payload = JSON.stringify(state, null, 2);
    await fs.promises.mkdir(this.dataDir, { recursive: true });
    await fs.promises.writeFile(this.file, payload, 'utf-8');
  }
}
