/**
 * X ChromaBot - server info context
 * Server-owned facts from /api/status that several screens need (default target tweet, AI availability).
 * The client never keeps its own copy of these defaults.
 */

import { createContext, useContext } from 'react';

export interface ServerInfo {
  /** Server default target tweet (env TARGET_TWEET_ID); empty when unset. */
  defaultTargetTweetId: string;
  /** undefined until the first status response; false when GEMINI_API_KEY is not set. */
  geminiConfigured?: boolean;
}

export const ServerInfoContext = createContext<ServerInfo>({ defaultTargetTweetId: '' });

export const useServerInfo = () => useContext(ServerInfoContext);
