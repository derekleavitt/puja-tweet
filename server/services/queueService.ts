/**
 * Upcoming-queue management: each context keeps a rolling window of pre-generated slots.
 */

import { ColorData, generateColor } from '../colorEngine.js';
import type { QueueSlot } from '../../shared/types.js';
import {
  QUEUE_SLOTS_PER_CONTEXT,
  createQueueSlotForContext,
  formatSlotPreviewText,
} from './queueSlots.js';
import type { StateManager } from './stateManager.js';

export class QueueService {
  constructor(private readonly sm: StateManager) {}

  /**
   * Clears existing queue slots for the specified campaign (or all campaigns if omitted)
   * and regenerates fresh slots based on the campaign's current template & schedule settings.
   */
  clearAndRegenerateQueue(contextId?: string): QueueSlot[] {
    const s = this.sm.state;
    const nowMs = Date.now();

    if (contextId) {
      const ctx = this.sm.getContext(contextId);
      if (!ctx) return this.getQueue();
      // Remove all slots belonging to this context (and any legacy untagged slots)
      s.queue = s.queue.filter((q) => q.contextId && q.contextId !== contextId);
      for (let i = 0; i < QUEUE_SLOTS_PER_CONTEXT; i++) {
        s.queue.push(createQueueSlotForContext(ctx, i, nowMs));
      }
      this.sm.persist();
      return s.queue.filter((q) => q.contextId === contextId);
    }

    s.queue = [];
    for (const ctx of s.contexts) {
      for (let i = 0; i < QUEUE_SLOTS_PER_CONTEXT; i++) {
        s.queue.push(createQueueSlotForContext(ctx, i, nowMs));
      }
    }
    this.sm.persist();
    return this.getQueue();
  }

  /** Read-only: never tops up or persists (see `ensureQueue`). */
  getQueue(contextId?: string): QueueSlot[] {
    const targetId = contextId || this.sm.state.activeContextId;
    return this.sm.state.queue.filter((q) => q.contextId === targetId);
  }

  rerollQueueSlot(slotId: string): QueueSlot | null {
    const s = this.sm.state;
    const idx = s.queue.findIndex((q) => q.slotId === slotId);
    if (idx === -1) return null;
    const current = s.queue[idx];
    // A slot always belongs to exactly one campaign; never re-render it with another's template.
    const ctx = current.contextId ? this.sm.getContext(current.contextId) : undefined;
    if (!ctx) return null;
    const newColor = generateColor(current.slotType);
    s.queue[idx] = {
      ...current,
      color: newColor,
      previewText: formatSlotPreviewText(ctx.template, newColor, current.timeSlot),
      contextId: ctx.id,
      contextName: ctx.name,
      targetTweetId: ctx.targetTweetId,
      replyTargetMode: ctx.replyTargetMode || 'original_post',
    };
    this.sm.persist();
    return s.queue[idx];
  }

  /** Removes a sent slot (scoped to its campaign) and tops the queue back up. */
  consumeQueueSlot(slotId: string, contextId?: string): boolean {
    const s = this.sm.state;
    const idx = s.queue.findIndex(
      (q) => q.slotId === slotId && (!contextId || q.contextId === contextId),
    );
    if (idx === -1) return false;
    const [removed] = s.queue.splice(idx, 1);
    this.ensureQueue(removed.contextId);
    this.sm.persist();
    return true;
  }

  popNextQueueSlot(slotType: 'morning' | 'evening', contextId?: string): ColorData {
    const s = this.sm.state;
    const targetId = contextId || s.activeContextId;
    this.ensureQueue(targetId);
    const nextIdx = s.queue.findIndex((q) => q.contextId === targetId);
    if (nextIdx !== -1) {
      const item = s.queue.splice(nextIdx, 1)[0];
      this.ensureQueue(targetId);
      this.sm.persist();
      return item.color;
    }
    return generateColor(slotType);
  }

  /** Tops every (or one) context's queue back up to the required length; persists only if it changed. */
  ensureQueue(contextId?: string) {
    const s = this.sm.state;
    const nowMs = Date.now();

    // Remove legacy untagged slots that lack contextId or previewText
    const hasLegacySlots = s.queue.some((q) => !q.contextId || !q.previewText);
    if (hasLegacySlots) {
      s.queue = s.queue.filter((q) => !!q.contextId && !!q.previewText);
    }

    // An unknown id tops up nothing (never another campaign's queue).
    const contextsToSync = contextId ? [this.sm.getContext(contextId)] : s.contexts;

    let modified = hasLegacySlots;
    for (const ctx of contextsToSync) {
      if (!ctx) continue;
      let idx = s.queue.filter((q) => q.contextId === ctx.id).length;
      while (idx < QUEUE_SLOTS_PER_CONTEXT) {
        s.queue.push(createQueueSlotForContext(ctx, idx, nowMs));
        idx++;
        modified = true;
      }
    }

    if (modified) this.sm.persist();
  }
}
