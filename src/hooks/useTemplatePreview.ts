/**
 * X ChromaBot - useTemplatePreview
 * "Test AI Generation": renders a tweet template server-side and tracks the result.
 */

import { useState } from 'react';
import { previewTemplate } from '../api/endpoints.js';

export function useTemplatePreview(template: string, contextId?: string) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const test = async () => {
    if (!template) return;
    setTesting(true);
    setResult(null);
    try {
      const data = await previewTemplate({ template, contextId });
      setResult(data.previewText || 'Could not generate preview.');
    } catch (err) {
      setResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setTesting(false);
    }
  };

  return { testing, result, test };
}
