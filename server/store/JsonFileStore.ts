/**
 * JSON-file persistence (`<DATA_DIR>/bot-store.json`) for local development.
 * Writes are atomic (temp file + rename) and the previous good file is kept as `.bak`.
 */

import fs from 'fs';
import path from 'path';
import { createDefaultState, normalizeState } from './defaults.js';
import type { BotState, Store } from './Store.js';

export const defaultDataDir = (): string =>
  process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve(process.cwd(), 'data');

export interface JsonFileStoreOptions {
  /** When true, an unreadable store (and backup) yields fresh defaults instead of failing boot. */
  allowFreshStore?: boolean;
}

export class JsonFileStore implements Store {
  private readonly dataDir: string;
  private readonly file: string;
  private readonly tmp: string;
  private readonly bak: string;
  private readonly allowFreshStore: boolean;

  constructor(dataDir: string = defaultDataDir(), options: JsonFileStoreOptions = {}) {
    this.dataDir = dataDir;
    this.file = path.join(dataDir, 'bot-store.json');
    this.tmp = `${this.file}.tmp`;
    this.bak = `${this.file}.bak`;
    this.allowFreshStore = options.allowFreshStore ?? process.env.ALLOW_FRESH_STORE === 'true';
  }

  async load(): Promise<BotState> {
    const hasMain = fs.existsSync(this.file);
    const hasBak = fs.existsSync(this.bak);
    if (!hasMain && !hasBak) return createDefaultState();

    if (hasMain) {
      try {
        return await this.read(this.file);
      } catch (err) {
        console.error('[Store] Could not read bot store file, trying backup:', err);
      }
    }
    if (hasBak) {
      try {
        const state = await this.read(this.bak);
        console.warn('[Store] Recovered state from bot-store.json.bak');
        return state;
      } catch (err) {
        console.error('[Store] Could not read backup file:', err);
      }
    }
    if (this.allowFreshStore) {
      console.warn('[Store] ALLOW_FRESH_STORE=true: starting with a fresh state');
      return createDefaultState();
    }
    throw new Error(
      `Bot store at ${this.file} is unreadable and no valid backup exists. ` +
        'Restore it manually or set ALLOW_FRESH_STORE=true to start fresh.',
    );
  }

  private async read(file: string): Promise<BotState> {
    return normalizeState(JSON.parse(await fs.promises.readFile(file, 'utf-8')));
  }

  async save(state: BotState): Promise<void> {
    const payload = JSON.stringify(state, null, 2);
    await fs.promises.mkdir(this.dataDir, { recursive: true });
    const handle = await fs.promises.open(this.tmp, 'w');
    try {
      await handle.writeFile(payload, 'utf-8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.promises.copyFile(this.file, this.bak).catch(() => undefined);
    await fs.promises.rename(this.tmp, this.file);
  }

  saveSync(state: BotState): void {
    const payload = JSON.stringify(state, null, 2);
    fs.mkdirSync(this.dataDir, { recursive: true });
    const fd = fs.openSync(this.tmp, 'w');
    try {
      fs.writeSync(fd, payload, null, 'utf-8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    try {
      fs.copyFileSync(this.file, this.bak);
    } catch {
      // no previous file yet
    }
    fs.renameSync(this.tmp, this.file);
  }
}
