/**
 * X ChromaBot - useAiPreview
 * Fetches the AI-generated tweet preview for the studio whenever its inputs change.
 */

import { useState, useEffect, useCallback } from 'react';
import { ColorData } from '../../types.js';
import { previewTemplate } from '../../api/endpoints.js';

interface UseAiPreviewOptions {
  hasAgentTag: boolean;
  template: string;
  color: ColorData;
  slotType: string;
  contextId: string;
}

export function useAiPreview({
  hasAgentTag,
  template,
  color,
  slotType,
  contextId,
}: UseAiPreviewOptions) {
  const [aiPreviewText, setAiPreviewText] = useState<string>('');
  const [isGeneratingAi, setIsGeneratingAi] = useState<boolean>(false);

  const fetchAiPreview = useCallback(async () => {
    if (!hasAgentTag) return;
    setIsGeneratingAi(true);
    try {
      const data = await previewTemplate({ template, color, slotType, contextId });
      if (data.previewText) {
        setAiPreviewText(data.previewText);
      }
    } catch (err) {
      console.error('Error fetching AI preview:', err);
    } finally {
      setIsGeneratingAi(false);
    }
  }, [hasAgentTag, template, color, slotType, contextId]);

  useEffect(() => {
    if (hasAgentTag) {
      fetchAiPreview();
    }
  }, [fetchAiPreview, hasAgentTag]);

  return { aiPreviewText, isGeneratingAi, fetchAiPreview };
}
