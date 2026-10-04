/**
 * X ChromaBot - useHistory
 * Post history: server logs.
 */

import { useState, useCallback } from 'react';
import { getHistory, clearHistory } from '../api/endpoints.js';
import { PostLog } from '../types.js';

export function useHistory() {
  const [logs, setLogs] = useState<PostLog[]>([]);

  const fetchHistory = useCallback(async () => {
    try {
      const data = await getHistory();
      setLogs(data?.logs || []);
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
