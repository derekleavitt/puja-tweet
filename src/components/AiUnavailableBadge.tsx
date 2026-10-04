/**
 * X ChromaBot - AiUnavailableBadge
 * Amber notice shown wherever AI features live when the server has no GEMINI_API_KEY.
 */

import React from 'react';
import { TriangleAlert } from 'lucide-react';
import { AI_UNAVAILABLE_HINT, useAiUnavailable } from '../context/serverInfo.js';

export const AiUnavailableBadge: React.FC = () => {
  if (!useAiUnavailable()) return null;
  return (
    <span
      role="status"
      title={AI_UNAVAILABLE_HINT}
      className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 inline-flex items-center gap-1 shrink-0"
    >
      <TriangleAlert className="w-3 h-3" />
      <span>AI unavailable</span>
    </span>
  );
};
