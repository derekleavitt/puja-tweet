/**
 * X ChromaBot - useCampaignPreview
 * The exact next tweet of ONE campaign, rendered by the server (`POST /api/template/preview` with
 * the campaign's id and its own template): text, evolved hashtags and the color it used. Posting
 * sends that text + hashtags + color back, so what goes out is exactly what was previewed.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { previewTemplate } from '../../api/endpoints.js';
import { ColorData, TweetContext } from '../../types.js';
import { errorMessage } from '../../lib/errors.js';

/** Color palette the preview draws from (only offered when the template uses a color token). */
export type PreviewSlot = 'morning' | 'evening' | 'manual';

export interface CampaignPreviewData {
  text: string;
  /** Evolved hashtags the text used (only when the campaign evolves its hashtags). */
  hashtags?: string[];
  color?: ColorData;
}

export function useCampaignPreview(context: TweetContext, open: boolean) {
  const [slot, setSlot] = useState<PreviewSlot>('morning');
  const [preview, setPreview] = useState<CampaignPreviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  // Anything that changes the next tweet's text re-renders the preview.
  const textKey = [
    context.template,
    context.schedule?.timezone,
    JSON.stringify(context.hashtagEvolution ?? null),
    (context.hashtagState?.current ?? []).join(','),
  ].join('|');

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const data = await previewTemplate({
        contextId: context.id,
        slotType: slot === 'manual' ? 'random' : slot,
      });
      if (id !== requestId.current) return;
      if (data.previewText) {
        setPreview({ text: data.previewText, hashtags: data.hashtags, color: data.color });
      } else {
        setPreview(null);
        setError((data as { error?: string }).error || 'Could not render the preview.');
      }
    } catch (err) {
      if (id === requestId.current) setError(errorMessage(err, 'Could not render the preview.'));
    } finally {
      if (id === requestId.current) setLoading(false);
    }
    // textKey is an intentional re-fetch trigger, not read inside the callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context.id, slot, textKey]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  /** Picking the current palette again re-rolls the color. */
  const pickSlot = (next: PreviewSlot) => (next === slot ? void load() : setSlot(next));

  return { slot, pickSlot, preview, loading, error, reload: load };
}
