/**
 * X ChromaBot - useQueue
 * Upcoming drop queue of ONE campaign (picked in the Queue screen) and its actions.
 * The pick is a UI filter only: it never changes which campaign the server treats as active.
 */

import { useState, useCallback, useEffect } from 'react';
import { getQueue, rerollSlot, regenerateQueue } from '../api/endpoints.js';
import { QueueSlot, TweetContext } from '../types.js';

export function useQueue(contexts: TweetContext[]) {
  const [pickedId, setPickedId] = useState<string>('');
  const [queue, setQueue] = useState<QueueSlot[]>([]);

  // Falls back to the first campaign when nothing (or a deleted campaign) is picked.
  const queueContextId = contexts.some((c) => c.id === pickedId) ? pickedId : contexts[0]?.id || '';

  const fetchQueue = useCallback(async () => {
    if (!queueContextId) return;
    try {
      const data = await getQueue(queueContextId);
      if (data) {
        setQueue(data.queue);
      }
    } catch (err) {
      console.error('Error fetching queue:', err);
    }
  }, [queueContextId]);

  useEffect(() => {
    void fetchQueue();
  }, [fetchQueue]);

  // Reroll queue slot
  const handleRerollSlot = async (slotId: string) => {
    try {
      const data = await rerollSlot(slotId);
      if (data) {
        await fetchQueue();
      }
    } catch (err) {
      console.error('Error rerolling slot:', err);
    }
  };

  // Clear and regenerate the shown campaign's 14-slot queue
  const handleRegenerateQueue = async () => {
    if (!queueContextId) return;
    try {
      const data = await regenerateQueue(queueContextId);
      if (data && Array.isArray(data.queue)) {
        setQueue(data.queue);
      } else {
        await fetchQueue();
      }
    } catch (err) {
      console.error('Error regenerating queue:', err);
    }
  };

  return {
    queue,
    queueContextId,
    setQueueContextId: setPickedId,
    fetchQueue,
    handleRerollSlot,
    handleRegenerateQueue,
  };
}
