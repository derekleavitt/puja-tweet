/**
 * In-memory Store used by tests (and usable as a no-persistence mode).
 */

import { createDefaultState, normalizeState } from './defaults.js';
import type { BotState, Store } from './Store.js';

export class MemoryStore implements Store {
  private saved: BotState | undefined;
  public saveCount = 0;

  constructor(initial?: Partial<BotState>) {
    if (initial) this.saved = structuredClone(normalizeState(initial));
  }

  async load(): Promise<BotState> {
    return this.saved ? structuredClone(this.saved) : createDefaultState();
  }

  async save(state: BotState): Promise<void> {
    this.saved = structuredClone(state);
    this.saveCount += 1;
  }

  /** The last persisted state (undefined until the first save). */
  snapshot(): BotState | undefined {
    return this.saved ? structuredClone(this.saved) : undefined;
  }
}
