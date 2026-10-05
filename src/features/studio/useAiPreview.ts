/**
 * X ChromaBot - useAiPreview
 * Fetches the AI-generated tweet preview for the studio whenever its inputs change.
 */

import { useState, useEffect, useCallback } from 'react';
import { ColorData } from '../../types.js';
import { previewTemplate } from '../../api/endpoints.js';

interface UseAiPreviewOptions {
  /** True when the text must come from the server (agent tags or evolving hashtags). */
  serverRendered: boolean;
  /** Changes whenever the preview should be re-rolled (e.g. after the campaign's tags advanced). */
  refreshKey?: string;
  template: string;
  color: ColorData;
  slotType: string;
  contextId: string;
}

export function useAiPreview({
  serverRendered,
  refreshKey = '',
  template,
  color,
  slotType,
  contextId,
}: UseAiPreviewOptions) {
  const [aiPreviewText, setAiPreviewText] = useState<string>('');
  const [aiPreviewTags, setAiPreviewTags] = useState<string[] | undefined>(undefined);
  const [isGeneratingAi, setIsGeneratingAi] = useState<boolean>(false);

  const fetchAiPreview = useCallback(async () => {
    if (!serverRendered) return;
    setIsGeneratingAi(true);
    try {
      const data = await previewTemplate({ template, color, slotType, contextId });
      if (data.previewText) {
        setAiPreviewText(data.previewText);
        setAiPreviewTags(data.hashtags);
      }
    } catch (err) {
      console.error('Error fetching AI preview:', err);
    } finally {
      setIsGeneratingAi(false);
    }
    // refreshKey is an intentional re-fetch trigger, not read inside the callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverRendered, template, color, slotType, contextId, refreshKey]);

  useEffect(() => {
    if (serverRendered) {
      fetchAiPreview();
    }
  }, [fetchAiPreview, serverRendered]);

  return { aiPreviewText, aiPreviewTags, isGeneratingAi, fetchAiPreview };
}
