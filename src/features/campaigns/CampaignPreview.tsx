/**
 * X ChromaBot - CampaignPreview
 * The campaign card's "Preview & post" panel: the exact next tweet (server-rendered with this
 * campaign's template, evolved hashtags and color), and the one action that posts exactly that
 * text. Simulated when the global or campaign dry run is on; a live post asks for confirmation.
 */

import React, { useState } from 'react';
import { Send, RefreshCw, Hash, X } from 'lucide-react';
import { DropResponse, TweetContext } from '../../types.js';
import { PostNowOptions } from '../../hooks/usePosting.js';
import { hasAgentTag } from '../../../shared/template/agentTags.js';
import { templateUsesColor } from '../../lib/templateTokens.js';
import { AiUnavailableBadge } from '../../components/AiUnavailableBadge.js';
import { useCampaignPreview } from './useCampaignPreview.js';
import { PreviewColorSlots } from './PreviewColorSlots.js';
import { PostResultToast } from './PostResultToast.js';
import { PreviewBreakdown } from './PreviewBreakdown.js';

interface CampaignPreviewProps {
  context: TweetContext;
  /** Posts from this campaign can only be simulated (global or campaign dry run). */
  simulated: boolean;
  onPost: (opts: PostNowOptions) => Promise<DropResponse | undefined>;
  onClose: () => void;
}

/** Where the next post goes, in words. */
function destination(ctx: TweetContext): string {
  const mode = ctx.engagementMode || 'reply';
  if (mode === 'standalone') return 'Timeline post (no parent)';
  if (mode === 'quote') return `Quote of #${ctx.targetTweetId}`;
  if (ctx.replyTargetMode === 'last_comment' && ctx.lastPostedTweetId) {
    return `Reply to our last comment #${ctx.lastPostedTweetId} (chain)`;
  }
  return `Reply to root post #${ctx.targetTweetId}`;
}

export const CampaignPreview: React.FC<CampaignPreviewProps> = ({
  context,
  simulated,
  onPost,
  onClose,
}) => {
  const { slot, pickSlot, preview, loading, error, reload } = useCampaignPreview(context, true);
  const [posting, setPosting] = useState(false);
  const [result, setResult] = useState<DropResponse | null>(null);
  const evolving = context.hashtagEvolution?.enabled === true;
  const text = preview?.text ?? '';
  const overLimit = text.length > 280;

  const post = async () => {
    if (!preview) return;
    setPosting(true);
    setResult(null);
    try {
      // Exactly what is shown: text + the hashtags it used + its color (BUG-3 contract).
      const res = await onPost({
        text: preview.text,
        hashtags: preview.hashtags,
        color: preview.color,
        slotType: slot,
      });
      if (res) setResult(res);
    } finally {
      setPosting(false);
    }
  };

  return (
    <div
      data-testid="campaign-preview"
      className="p-3 rounded-lg border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/40 dark:bg-indigo-950/20 space-y-2.5 text-xs"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-semibold text-neutral-800 dark:text-neutral-200">Next tweet</span>
          {hasAgentTag(context.template) && <AiUnavailableBadge />}
          {evolving && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-teal-100 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800 inline-flex items-center gap-1">
              <Hash className="w-2.5 h-2.5" />
              Evolving hashtags
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className={`font-mono tabular-nums ${overLimit ? 'text-red-500 font-bold' : 'text-neutral-400'}`}
          >
            {text.length} / 280
          </span>
          <button
            type="button"
            onClick={() => void reload()}
            disabled={loading}
            title="Re-render the preview"
            className="p-1 text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-white dark:hover:bg-neutral-800 rounded transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={onClose}
            title="Close preview"
            className="p-1 text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-white dark:hover:bg-neutral-800 rounded transition-colors cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {templateUsesColor(context.template) && (
        <PreviewColorSlots selected={slot} disabled={loading} onPick={pickSlot} />
      )}

      <div className="text-[11px] text-neutral-500 font-mono">{destination(context)}</div>

      <div
        data-testid="tweet-preview-text"
        className="p-2.5 rounded-md bg-white dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 text-sm text-neutral-800 dark:text-neutral-200 whitespace-pre-line leading-relaxed min-h-12"
      >
        {preview ? preview.text : loading ? 'Rendering preview…' : ''}
      </div>
      {error && <p className="text-[11px] text-red-600 dark:text-red-400">{error}</p>}

      {preview?.hashtags && preview.hashtags.length > 0 && (
        <div data-testid="preview-hashtags" className="flex items-center gap-1 flex-wrap">
          <span className="text-[10px] uppercase font-mono text-neutral-400">Hashtags:</span>
          {preview.hashtags.map((tag) => (
            <span
              key={tag}
              className="px-1.5 py-0.5 rounded bg-teal-50 dark:bg-teal-950/50 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800 font-mono text-[11px]"
            >
              #{tag}
            </span>
          ))}
        </div>
      )}

      <PreviewBreakdown breakdown={preview?.breakdown} />

      <button
        type="button"
        onClick={post}
        disabled={!preview || loading || posting || overLimit}
        className="w-full py-2 px-3 bg-neutral-900 hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200 text-white text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer shadow-xs"
      >
        {posting ? (
          <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white dark:border-neutral-900/30 dark:border-t-neutral-900 rounded-full animate-spin" />
        ) : (
          <Send className="w-3.5 h-3.5" />
        )}
        {simulated ? 'Post now (simulated)' : 'Post now (live)'}
      </button>
      <p className="text-[11px] text-neutral-500">
        Posts exactly this text.{' '}
        {simulated
          ? 'Dry run is on, so nothing is sent to X.'
          : 'Live: you will be asked to confirm.'}
      </p>

      {result && <PostResultToast lastPostedResult={result} />}
    </div>
  );
};
