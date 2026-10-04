/**
 * X ChromaBot - useHistory
 * Post history: server logs merged with Firestore logs.
 */

import { useState, useCallback } from 'react';
import { getHistory, clearHistory } from '../api/endpoints.js';
import { loadFirestoreLogs } from '../lib/firestoreSync.js';
import { PostLog } from '../types.js';

export function useHistory() {
  const [logs, setLogs] = useState<PostLog[]>([]);

  const fetchHistory = useCallback(async () => {
    try {
      // 1. Fetch server logs
      const data = await getHistory();
      const combinedLogs: PostLog[] = data?.logs || [];

      // 2. Fetch firestore logs if present
      const cloudLogs = await loadFirestoreLogs();
      if (cloudLogs && cloudLogs.length > 0) {
        const idSet = new Set(combinedLogs.map((l) => l.id));
        cloudLogs.forEach((cl) => {
          if (!idSet.has(cl.id)) {
            combinedLogs.push(cl);
          }
        });
        combinedLogs.sort(
          (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
        );
      }

      setLogs(combinedLogs);
    } catch (err) {
      console.error('Error fetching logs:', err);
    }
  }, []);

  // Clear history
  const handleClearHistory = async () => {
    const data = await clearHistory();
    if (data) {
      setLogs([]);
    }
  };

  return { logs, setLogs, fetchHistory, handleClearHistory };
}
