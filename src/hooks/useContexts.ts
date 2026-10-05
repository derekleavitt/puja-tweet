/**
 * X ChromaBot - useContexts
 * Campaign (context) mutations. Every action names the campaign it acts on.
 */

import {
  createContext,
  updateContext,
  deleteContext,
  duplicateContext,
  toggleContext,
  clearContextHistory,
} from '../api/endpoints.js';
import { PostLog, TweetContext } from '../types.js';

interface UseContextsDeps {
  setLogs: (update: (prev: PostLog[]) => PostLog[]) => void;
  refresh: () => Promise<void>;
  fetchHistory: () => Promise<void>;
}

export function useContexts({ setLogs, refresh, fetchHistory }: UseContextsDeps) {
  const handleCreateContext = async (data: Partial<TweetContext>) => {
    await createContext(data);
    await refresh();
  };

  const handleUpdateContext = async (id: string, updates: Partial<TweetContext>) => {
    // The chain anchor is server-owned. A caller that wants "reset to root" passes
    // `lastPostedTweetId: undefined`; JSON would drop that key, so send an explicit null.
    const body: Record<string, unknown> = { ...updates };
    if ('lastPostedTweetId' in updates && !updates.lastPostedTweetId) body.lastPostedTweetId = null;
    await updateContext(id, body as Partial<TweetContext>);
    await refresh();
  };

  const handleDeleteContext = async (id: string) => {
    await deleteContext(id);
    await refresh();
  };

  const handleDuplicateContext = async (id: string) => {
    await duplicateContext(id);
    await refresh();
  };

  const handleToggleContext = async (id: string) => {
    await toggleContext(id);
    await refresh();
  };

  const handleClearContextHistory = async (id: string) => {
    try {
      await clearContextHistory(id);
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
    handleCreateContext,
    handleUpdateContext,
    handleDeleteContext,
    handleDuplicateContext,
    handleToggleContext,
    handleClearContextHistory,
  };
}
