/**
 * Holds the live `BotState` and persists it through a `Store`.
 * Saves are debounced (at most one write per `SAVE_DEBOUNCE_MS`) and serialised;
 * `persist()` is fire-and-forget, `flush()` writes now and awaits, `flushSync()` is for shutdown.
 */

import type { TweetContext } from '../../shared/types.js';
import type { BotState, Store } from '../store/Store.js';

export const SAVE_DEBOUNCE_MS = 250;

/** In-memory (and persisted) log cap, from `MAX_LOGS` (default 500). */
export const maxLogs = (): number => {
  const n = Number(process.env.MAX_LOGS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 500;
};

export class StateManager {
  public readonly state: BotState;
  private readonly store: Store;
  private chain: Promise<void> = Promise.resolve();
  private timer: NodeJS.Timeout | undefined;
  private dirty = false;

  private constructor(store: Store, state: BotState) {
    this.store = store;
    this.state = state;
    const cap = maxLogs();
    if (state.logs.length > cap) state.logs.splice(0, state.logs.length - cap);
  }

  static async create(store: Store): Promise<StateManager> {
    return new StateManager(store, await store.load());
  }

  /** Marks the state dirty and schedules a debounced save (latest state wins). */
  persist(): void {
    this.dirty = true;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.enqueueSave();
    }, SAVE_DEBOUNCE_MS);
    this.timer.unref();
  }

  private snapshot(): BotState {
    return { ...this.state, logs: this.state.logs.slice(-maxLogs()) };
  }

  private enqueueSave(): void {
    if (!this.dirty) return;
    this.dirty = false;
    const snapshot = this.snapshot();
    this.chain = this.chain.then(async () => {
      try {
        await this.store.save(snapshot);
      } catch (err) {
        console.error('[Store] Error saving bot state:', err);
      }
    });
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  /** Writes any pending state immediately and resolves once every write has finished. */
  flush(): Promise<void> {
    this.clearTimer();
    this.enqueueSave();
    return this.chain;
  }

  /** Synchronous last-chance write for SIGTERM/SIGINT (no-op for stores without `saveSync`). */
  flushSync(): void {
    this.clearTimer();
    if (!this.dirty) return;
    this.dirty = false;
    this.store.saveSync?.(this.snapshot());
  }

  getContext(id: string): TweetContext | undefined {
    return this.state.contexts.find((c) => c.id === id);
  }

  getActiveContext(): TweetContext {
    return this.getContext(this.state.activeContextId) ?? this.state.contexts[0];
  }
}
