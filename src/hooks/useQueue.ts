/**
 * X ChromaBot - useQueue
 * Upcoming drop queue state and its actions.
 */

import { useState, useCallback } from 'react';
import { getQueue, rerollSlot, regenerateQueue } from '../api/endpoints.js';
import { QueueSlot } from '../types.js';

export function useQueue() {
  const [queue, setQueue] = useState<QueueSlot[]>([]);

  const fetchQueue = useCallback(async () => {
    try {
      const data = await getQueue();
      if (data) {
        setQueue(data.queue);
      }
    } catch (err) {
      console.error('Error fetching queue:', err);
    }
  }, []);

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

  // Clear and regenerate entire 14-slot queue for campaign
  const handleRegenerateQueue = async (contextId: string) => {
    try {
      const data = await regenerateQueue(contextId);
      if (data) {
        if (Array.isArray(data.queue)) {
          setQueue(data.queue);
        } else {
          await fetchQueue();
        }
      }
    } catch (err) {
      console.error('Error regenerating queue:', err);
    }
  };

  return { queue, setQueue, fetchQueue, handleRerollSlot, handleRegenerateQueue };
}
