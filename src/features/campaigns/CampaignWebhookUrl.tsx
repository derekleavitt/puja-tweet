/**
 * X ChromaBot - CampaignWebhookUrl
 * Campaign form: the external-cron trigger URL pinned to THIS campaign (`?contextId=`), so a
 * cron job can never post another campaign. The shared secret itself is rotated in Settings.
 */

import React, { useEffect, useState } from 'react';
import { Globe } from 'lucide-react';
import { getWebhookUrl } from '../../api/endpoints.js';
import { LABEL_CLASS } from './constants.js';

export const CampaignWebhookUrl: React.FC<{ contextId: string }> = ({ contextId }) => {
  const [url, setUrl] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getWebhookUrl(contextId)
      .then((r) => {
        if (!cancelled) setUrl(r.url);
      })
      .catch(() => {
        if (!cancelled) setUrl('');
      });
    return () => {
      cancelled = true;
    };
  }, [contextId]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.warn('Clipboard unavailable:', err);
    }
  };

  if (!url) return null;
  return (
    <div className="space-y-1.5 pt-2 border-t border-neutral-100 dark:border-neutral-800">
      <label className={`${LABEL_CLASS} flex items-center gap-1.5`}>
        <Globe className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
        Webhook trigger URL for this campaign
      </label>
      <div className="flex items-center gap-2">
        <input
          type="text"
          readOnly
          aria-label="Campaign webhook URL"
          value={url}
          className="w-full px-3 py-2 text-[11px] font-mono border border-neutral-200 dark:border-neutral-700 rounded-lg bg-neutral-100 dark:bg-neutral-950 text-neutral-700 dark:text-neutral-300 select-all"
        />
        <button
          type="button"
          onClick={copy}
          className="px-3 py-2 text-xs font-semibold bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-neutral-800 dark:text-neutral-200 rounded-lg transition-colors shrink-0 cursor-pointer"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <p className="text-[11px] text-neutral-500">
        Ping it from any cron tool to post this campaign (GET simulates; live posting requires
        POST). Global pause and dry run still apply.
      </p>
    </div>
  );
};
