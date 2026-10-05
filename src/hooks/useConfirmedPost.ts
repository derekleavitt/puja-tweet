/**
 * X ChromaBot - useConfirmedPost
 * Wraps the manual "post now" flow: a live (non dry-run) post first asks for confirmation,
 * naming the campaign and its target; simulated posts go straight through. The returned promise
 * resolves with the post result, or `undefined` when the owner cancels.
 */

import { useRef, useState } from 'react';
import { BotSettings, DropResponse, TweetContext } from '../types.js';
import { PostNowOptions } from './usePosting.js';

export interface PendingPost {
  campaign: string;
  targetTweetId: string;
}

interface Deps {
  settings: BotSettings;
  contexts: TweetContext[];
  post: (contextId: string, opts?: PostNowOptions) => Promise<DropResponse>;
}

/** True when a post for this campaign can only be simulated (global or campaign dry run). */
export const isSimulatedFor = (settings: BotSettings, ctx?: TweetContext): boolean =>
  settings.globalDryRun !== false || ctx?.dryRun === true;

export function useConfirmedPost({ settings, contexts, post }: Deps) {
  const [pending, setPending] = useState<PendingPost | null>(null);
  const resolver = useRef<((go: boolean) => void) | null>(null);

  const request = async (
    contextId: string,
    opts?: PostNowOptions,
  ): Promise<DropResponse | undefined> => {
    const ctx = contexts.find((c) => c.id === contextId);
    if (isSimulatedFor(settings, ctx)) return post(contextId, opts);
    const go = await new Promise<boolean>((resolve) => {
      resolver.current?.(false);
      resolver.current = resolve;
      setPending({
        campaign: ctx?.name || contextId,
        targetTweetId: ctx?.targetTweetId || '',
      });
    });
    return go ? post(contextId, opts) : undefined;
  };

  const settle = (go: boolean) => {
    setPending(null);
    resolver.current?.(go);
    resolver.current = null;
  };

  return { pending, request, confirm: () => settle(true), cancel: () => settle(false) };
}
