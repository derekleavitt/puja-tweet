/**
 * X ChromaBot - usePosting
 * The manual "post now" flow. Every call names the campaign it posts for.
 */

import { useState } from 'react';
import { postNow, type ConversationEcho } from '../api/endpoints.js';
import { ColorData, DropResponse, PostLog } from '../types.js';
import { errorMessage } from '../lib/errors.js';

export interface PostNowOptions {
  color?: ColorData | null;
  slotType?: 'morning' | 'evening' | 'manual';
  /** Exact previewed text to post verbatim (BUG-3: send it with the preview's `hashtags`). */
  text?: string;
  hashtags?: string[];
  slotId?: string;
  /** Conversation turn the text was previewed for (the server rejects a stale one with 409). */
  conversation?: ConversationEcho;
  /** Conversation turns: speaker handle (no '@'), used only to name the speaker in the confirm dialog. */
  speakerHandle?: string;
}

interface UsePostingDeps {
  addLog: (log: PostLog) => void;
  refresh: () => Promise<void>;
}

export function usePosting({ addLog, refresh }: UsePostingDeps) {
  const [isPosting, setIsPosting] = useState<boolean>(false);

  const handlePostNow = async (
    contextId: string,
    opts: PostNowOptions = {},
  ): Promise<DropResponse> => {
    setIsPosting(true);
    try {
      const data = await postNow({
        slotType: opts.slotType || 'manual',
        color: opts.color ?? null,
        contextId,
        ...(opts.text ? { text: opts.text } : {}),
        ...(opts.text && opts.hashtags ? { hashtags: opts.hashtags } : {}),
        ...(opts.slotId ? { slotId: opts.slotId } : {}),
        ...(opts.conversation ? { conversation: opts.conversation } : {}),
      });
      if (data.log) {
        addLog(data.log);
      }
      await refresh();
      return data;
    } catch (err) {
      console.error('Error posting now:', err);
      return { success: false, error: errorMessage(err) };
    } finally {
      setIsPosting(false);
    }
  };

  return { isPosting, handlePostNow };
}
