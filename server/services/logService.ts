/**
 * Post log history.
 */

import type { PostLog, TweetContext } from '../../shared/types.js';
import type { QueueService } from './queueService.js';
import { maxLogs, type StateManager } from './stateManager.js';

export class LogService {
  constructor(
    private readonly sm: StateManager,
    private readonly queue: QueueService,
  ) {}

  /** Newest first. */
  getLogs(): PostLog[] {
    return [...this.sm.state.logs].reverse();
  }

  addLog(log: PostLog) {
    const logs = this.sm.state.logs;
    logs.push(log);
    const cap = maxLogs();
    if (logs.length > cap) logs.splice(0, logs.length - cap);
    this.sm.persist();
  }

  clearLogs() {
    this.sm.state.logs = [];
    this.sm.persist();
  }

  clearContextHistory(contextId: string): { clearedCount: number; context?: TweetContext } {
    const s = this.sm.state;
    const beforeCount = s.logs.length;
    // Drop logs of this context (for the primary context also logs without a contextId)
    s.logs = s.logs.filter((l) => {
      if (contextId === 'ctx_primary') {
        return l.contextId && l.contextId !== 'ctx_primary';
      }
      return l.contextId !== contextId;
    });
    const clearedCount = beforeCount - s.logs.length;

    // Reset this campaign's stats and clock only. Clearing history is log cleanup, not a chain
    // reset: the chain anchor (verified by its own provenance, not by these logs) is kept, so the
    // next drop still continues the thread. "Reset to root" / reset-chain is the explicit action.
    const ctx = this.sm.getContext(contextId);
    if (ctx) {
      ctx.stats = { totalPosts: 0, successfulPosts: 0, simulatedPosts: 0, failedPosts: 0 };
      ctx.lastPostedTimestamp = Date.now(); // restart the interval, never fire at once
      ctx.lastPostedSlot = undefined;
      // The `<history>` memory of a single campaign goes with its logs. A conversation keeps its
      // transcript buffer: its turn count goes on, and Restart is the way to start over.
      if (ctx.mode !== 'conversation') ctx.recentPosts = [];
      this.queue.clearAndRegenerateQueue(contextId);
    }
    this.sm.persist();
    return { clearedCount, context: ctx };
  }
}
