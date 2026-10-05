/** TEMPORARY stub; replaced by the real implementation. */
import type { TweetContext } from '../../shared/types.js';

export interface ConversationTurn {
  runId: string;
  turnNumber: number;
  speakerAccountId: string;
  speakerHandle: string;
  nextSpeakerAccountId: string;
  nextSpeakerHandle: string;
  text: string;
  replyToTweetId: string;
  summaryUsed: boolean;
  transcriptLength: number;
}

export async function buildTurn(_ctx: TweetContext): Promise<ConversationTurn> {
  throw new Error('conversationService.buildTurn is not implemented yet');
}
