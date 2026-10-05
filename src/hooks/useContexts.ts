/**
 * X ChromaBot - useContexts
 * Campaign (context) mutations.
 */

import {
  activateContext,
  createContext,
  updateContext,
  deleteContext,
  duplicateContext,
  toggleContext,
  triggerContext,
  clearContextHistory,
} from '../api/endpoints.js';
import { ApiResult, PostLog, QueueSlot, TweetContext } from '../types.js';

interface UseContextsDeps {
  setActiveContextId: (id: string) => void;
  setQueue: (queue: QueueSlot[]) => void;
  setLogs: (update: (prev: PostLog[]) => PostLog[]) => void;
  addLog: (log: PostLog) => void;
  refresh: () => Promise<void>;
  fetchHistory: () => Promise<void>;
  generateColor: (slotType?: 'morning' | 'evening' | 'random') => Promise<void>;
}

export function useContexts(deps: UseContextsDeps) {
  const { setActiveContextId, setQueue, setLogs, addLog, refresh, fetchHistory, generateColor } =
    deps;

  /** Applies a mutation result (regenerated queue) then refreshes status. */
  const applyResult = async (json: ApiResult) => {
    if (Array.isArray(json.queue)) {
      setQueue(json.queue);
    }
    await refresh();
  };

  const handleSelectActiveContext = async (id: string) => {
    try {
      const json = await activateContext(id);
      if (json) {
        setActiveContextId(id);
        if (Array.isArray(json.queue)) {
          setQueue(json.queue);
        }
        await refresh();
        await generateColor('morning');
      }
    } catch (err) {
      console.error('Error switching active context:', err);
    }
  };

  const handleCreateContext = async (data: Partial<TweetContext>) => {
    await applyResult(await createContext(data));
  };

  const handleUpdateContext = async (id: string, updates: Partial<TweetContext>) => {
    // The chain anchor is server-owned. A caller that wants "reset to root" passes
    // `lastPostedTweetId: undefined`; JSON would drop that key, so send an explicit null.
    const body: Record<string, unknown> = { ...updates };
    if ('lastPostedTweetId' in updates && !updates.lastPostedTweetId) body.lastPostedTweetId = null;
    await applyResult(await updateContext(id, body as Partial<TweetContext>));
  };

  const handleDeleteContext = async (id: string) => {
    const json = await deleteContext(id);
    if (Array.isArray(json.queue)) {
      setQueue(json.queue);
    }
    await refresh();
  };

  const handleDuplicateContext = async (id: string) => {
    const json = await duplicateContext(id);
    if (json) await applyResult(json);
  };

  const handleToggleContext = async (id: string) => {
    const json = await toggleContext(id);
    if (json) await applyResult(json);
  };

  const handleTriggerContext = async (id: string) => {
    const data = await triggerContext(id);
    if (data.log) {
      addLog(data.log);
    }
    await refresh();
    return data;
  };

  const handleClearContextHistory = async (id: string) => {
    try {
      const json = await clearContextHistory(id);
      if (Array.isArray(json.queue)) {
        setQueue(json.queue);
      }
      setLogs((prev) =>
        prev.filter((l) =>
          id === 'ctx_primary' ? l.contextId && l.contextId !== 'ctx_primary' : l.contextId !== id,
        ),
      );
      await fetchHistory();
      await refresh();
    } catch (err) {
      console.error('Error clearing context history:', err);
    }
  };

  return {
    handleSelectActiveContext,
    handleCreateContext,
    handleUpdateContext,
    handleDeleteContext,
    handleDuplicateContext,
    handleToggleContext,
    handleTriggerContext,
    handleClearContextHistory,
  };
}
