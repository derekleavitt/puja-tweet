/**
 * X ChromaBot - WebhookSettings
 * Global webhook secret: the legacy (unpinned) trigger URL, copy and secret rotation. Each
 * campaign's own pinned URL is shown in its edit form.
 */

import React, { useState, useEffect } from 'react';
import { Globe, Key } from 'lucide-react';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog.js';
import { getWebhookUrl, rotateWebhookSecret } from '../../api/endpoints.js';

interface WebhookSettingsProps {
  onCopied: () => void;
}

export const WebhookSettings: React.FC<WebhookSettingsProps> = ({ onCopied }) => {
  const [webhookUrl, setWebhookUrl] = useState('');
  const [confirmRotate, setConfirmRotate] = useState(false);

  useEffect(() => {
    getWebhookUrl()
      .then((r) => setWebhookUrl(r.url))
      .catch(() => setWebhookUrl(''));
  }, []);

  const handleRotateSecret = async () => {
    setConfirmRotate(false);
    try {
      const r = await rotateWebhookSecret();
      setWebhookUrl(r.url);
    } catch (err) {
      console.error('Error rotating webhook secret:', err);
    }
  };

  return (
    <div className="border border-neutral-200 dark:border-neutral-800 rounded-xl p-5 bg-white dark:bg-neutral-900 space-y-4 shadow-xs">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wider text-neutral-700 dark:text-neutral-300 flex items-center gap-2">
          <Globe className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          Autonomous Webhook Trigger (Zero-Maintenance)
        </span>
        <span className="text-[11px] px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-medium">
          No GitHub Actions Auth Required
        </span>
      </div>

      <p className="text-xs text-neutral-500 leading-relaxed">
        Because this web app already has working X credentials, you can ping this URL from any free
        recurring cron tool (e.g.{' '}
        <a
          href="https://cron-job.org"
          target="_blank"
          rel="noreferrer"
          className="text-blue-600 dark:text-blue-400 underline"
        >
          cron-job.org
        </a>{' '}
        or{' '}
        <a
          href="https://uptimerobot.com"
          target="_blank"
          rel="noreferrer"
          className="text-blue-600 dark:text-blue-400 underline"
        >
          UptimeRobot
        </a>
        ) at your desired frequency. Each ping wakes the app and immediately publishes a reply. This
        URL is not pinned to a campaign (it posts the server's default campaign); copy a campaign's
        own URL from its edit form instead. All URLs share the secret rotated here.
      </p>

      <div className="space-y-1.5">
        <label className="text-[11px] font-semibold text-neutral-600 dark:text-neutral-400">
          One-Click Autonomous URL (GET or POST; live posting requires POST):
        </label>
        <div className="flex items-center gap-2">
          <input
            type="text"
            readOnly
            value={webhookUrl}
            className="w-full px-3 py-2 text-xs font-mono border border-neutral-200 dark:border-neutral-800 rounded-lg bg-neutral-100 dark:bg-neutral-950 text-neutral-700 dark:text-neutral-300 select-all"
          />
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(webhookUrl);
              onCopied();
            }}
            className="px-3 py-2 text-xs font-semibold bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-neutral-800 dark:text-neutral-200 rounded-lg transition-colors shrink-0 cursor-pointer"
          >
            Copy URL
          </button>
          <button
            type="button"
            onClick={() => setConfirmRotate(true)}
            className="px-3 py-2 text-xs font-semibold bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-neutral-800 dark:text-neutral-200 rounded-lg transition-colors shrink-0 cursor-pointer flex items-center gap-1.5"
          >
            <Key className="w-3.5 h-3.5" /> Rotate Secret
          </button>
        </div>
      </div>

      {confirmRotate && (
        <ConfirmDialog
          title="Rotate webhook secret?"
          message="Existing cron jobs using the old URL will stop working."
          confirmLabel="Rotate"
          destructive
          onConfirm={handleRotateSecret}
          onCancel={() => setConfirmRotate(false)}
        />
      )}
    </div>
  );
};
