/**
 * Holds the live `BotState` and persists it through a `Store`.
 * Writes are coalesced and serialised: `persist()` is fire-and-forget, `flush()` awaits the last write.
 */

import type { TweetContext } from '../../shared/types.js';
import type { BotState, Store } from '../store/Store.js';

const MAX_PERSISTED_LOGS = 150;

export class StateManager {
  public readonly state: BotState;
  private readonly store: Store;
  private chain: Promise<void> = Promise.resolve();
  private writeQueued = false;

  private constructor(store: Store, state: BotState) {
    this.store = store;
    this.state = state;
  }

  static async create(store: Store): Promise<StateManager> {
    return new StateManager(store, await store.load());
  }

  /** Schedules a save of the current state (latest state wins when saves pile up). */
  persist(): void {
    if (this.writeQueued) return;
    this.writeQueued = true;
    this.chain = this.chain.then(async () => {
      this.writeQueued = false;
      try {
        await this.store.save({ ...this.state, logs: this.state.logs.slice(-MAX_PERSISTED_LOGS) });
      } catch (err) {
        console.error('[Store] Error saving bot state:', err);
      }
    });
  }

  /** Resolves once every scheduled write has finished. */
  flush(): Promise<void> {
    return this.chain;
  }

  getContext(id: string): TweetContext | undefined {
    return this.state.contexts.find((c) => c.id === id);
  }

  getActiveContext(): TweetContext {
    return this.getContext(this.state.activeContextId) ?? this.state.contexts[0];
  }
}
