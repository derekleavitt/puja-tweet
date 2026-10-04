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

    // Reset campaign stats and anchors
    const ctx = this.sm.getContext(contextId);
    if (ctx) {
      ctx.stats = { totalPosts: 0, successfulPosts: 0, simulatedPosts: 0, failedPosts: 0 };
      ctx.lastPostedTimestamp = Date.now(); // restart the interval, never fire at once
      ctx.lastPostedSlot = undefined;
      ctx.lastPostedTweetId = undefined; // Reset chain anchor to clean slate
      if (s.activeContextId === contextId) {
        s.settings.lastPostedTweetId = undefined;
      }
      this.queue.clearAndRegenerateQueue(contextId);
    }
    this.sm.persist();
    return { clearedCount, context: ctx };
  }
}
