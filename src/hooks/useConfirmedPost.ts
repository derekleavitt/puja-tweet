/**
 * X ChromaBot - useConfirmedPost
 * Wraps the manual "post now" flow: a live (non dry-run) post first asks for confirmation,
 * naming the campaign and its target; simulated posts go straight through.
 */

import { useState } from 'react';
import { BotSettings, TweetContext } from '../types.js';

export interface PendingPost<Args extends unknown[]> {
  args: Args;
  campaign: string;
  targetTweetId: string;
}

interface Deps<Args extends unknown[], R> {
  settings: BotSettings;
  contexts: TweetContext[];
  activeContextId: string;
  post: (...args: Args) => Promise<R>;
  /** Position of the optional `contextId` argument inside `Args`. */
  contextArgIndex: number;
}

export function useConfirmedPost<Args extends unknown[], R>({
  settings,
  contexts,
  activeContextId,
  post,
  contextArgIndex,
}: Deps<Args, R>) {
  const [pending, setPending] = useState<PendingPost<Args> | null>(null);

  const request = async (...args: Args): Promise<R | undefined> => {
    const id = (args[contextArgIndex] as string | undefined) || activeContextId;
    const ctx = contexts.find((c) => c.id === id);
    const isSimulated = settings.globalDryRun !== false || ctx?.dryRun === true;
    if (isSimulated) return post(...args);
    setPending({
      args,
      campaign: ctx?.name || 'Active campaign',
      targetTweetId: ctx?.targetTweetId || settings.targetTweetId,
    });
    return undefined;
  };

  const confirm = () => {
    if (!pending) return;
    const { args } = pending;
    setPending(null);
    void post(...args);
  };

  return { pending, request, confirm, cancel: () => setPending(null) };
}
