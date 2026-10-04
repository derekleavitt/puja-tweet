/**
 * X ChromaBot - PostResultToast
 * Feedback card for the last post / simulation attempt.
 */

import React from 'react';
import { Check, ExternalLink, AlertCircle } from 'lucide-react';

interface PostResultToastProps {
  lastPostedResult: any;
}

export const PostResultToast: React.FC<PostResultToastProps> = ({ lastPostedResult }) => (
  <div
    className={`p-4 rounded-xl border text-xs space-y-1.5 transition-all ${
      lastPostedResult.success
        ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
        : 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800 text-red-900 dark:text-red-200'
    }`}
  >
    <div className="flex items-center justify-between font-semibold">
      <span className="flex items-center gap-1.5">
        {lastPostedResult.success ? (
          <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
        ) : (
          <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400" />
        )}
        {lastPostedResult.result?.simulated
          ? 'Reply Simulated Successfully'
          : lastPostedResult.success
            ? 'Reply Successfully Posted to X!'
            : 'Failed to Post Reply'}
      </span>
      {lastPostedResult.result?.url && (
        <a
          href={lastPostedResult.result.url}
          target="_blank"
          rel="noopener noreferrer"
          className="underline font-mono inline-flex items-center gap-1 hover:text-blue-600"
        >
          View on X <ExternalLink className="w-3 h-3" />
        </a>
      )}
    </div>
    <p className="text-[11px] opacity-90 leading-relaxed">
      {lastPostedResult.result?.simulated
        ? 'Simulated payload validated. Simulated replies show exact text, character count, and time tags without spending X credits.'
        : lastPostedResult.success
          ? `Tweet ID: ${lastPostedResult.result?.tweetId}`
          : `Error: ${lastPostedResult.error || lastPostedResult.result?.error}`}
    </p>

    {!lastPostedResult.success && (lastPostedResult.error || '').includes('Credits Depleted') && (
      <div className="mt-2 pt-2 border-t border-red-200 dark:border-red-800/60 text-[11px] space-y-1">
        <p className="font-medium text-red-900 dark:text-red-200">
          💡 Why this happens: Your X account is verified, but X (Twitter) now requires prepaid
          developer credits to send live automated tweets.
        </p>
        <div className="flex items-center gap-3 pt-1">
          <a
            href="https://developer.x.com/en/portal/billing"
            target="_blank"
            rel="noopener noreferrer"
            className="underline font-semibold inline-flex items-center gap-1 text-red-800 dark:text-red-200 hover:text-blue-600"
          >
            Open X Billing / Credits Portal <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>
    )}
  </div>
);
