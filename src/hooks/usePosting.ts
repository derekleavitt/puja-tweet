/**
 * X ChromaBot - usePosting
 * Current color preview and the manual "post now" flow.
 */

import { useState, useCallback } from 'react';
import { generateColor as apiGenerateColor, postNow } from '../api/endpoints.js';
import { ColorData, PostLog } from '../types.js';

interface UsePostingDeps {
  activeContextId: string;
  addLog: (log: PostLog) => void;
  refresh: () => Promise<void>;
}

export function usePosting({ activeContextId, addLog, refresh }: UsePostingDeps) {
  const [color, setColor] = useState<ColorData | null>(null);
  const [isPosting, setIsPosting] = useState<boolean>(false);
  const [lastPostedResult, setLastPostedResult] = useState<any>(null);

  const generateColor = useCallback(
    async (slotType: 'morning' | 'evening' | 'random' = 'morning') => {
      try {
        const data = await apiGenerateColor(slotType, activeContextId);
        if (data) {
          setColor(data.color);
        }
      } catch (err) {
        console.error('Error generating color:', err);
      }
    },
    [activeContextId],
  );

  // Handle post now (manual trigger)
  const handlePostNow = async (
    customColor?: ColorData,
    slotType: 'morning' | 'evening' | 'manual' = 'manual',
    contextId?: string,
  ) => {
    setIsPosting(true);
    setLastPostedResult(null);

    try {
      const data = await postNow({
        slotType,
        color: customColor || color,
        contextId: contextId || activeContextId,
      });
      setLastPostedResult(data);

      if (data.log) {
        addLog(data.log);
      }

      await refresh();
      return data;
    } catch (err: any) {
      console.error('Error posting now:', err);
      const errObj = { success: false, error: err.message };
      setLastPostedResult(errObj);
      return errObj;
    } finally {
      setIsPosting(false);
    }
  };

  return { color, isPosting, lastPostedResult, generateColor, handlePostNow };
}
