import React, { useState, useEffect } from 'react';
import { Copy, Check, Terminal, ExternalLink, Globe, Key, ShieldCheck, Zap } from 'lucide-react';
import { BotSettings } from '../types.js';

interface StandaloneExportProps {
  settings: BotSettings;
}

export const StandaloneExport: React.FC<StandaloneExportProps> = ({ settings }) => {
  const [data, setData] = useState<{ githubActionsYaml: string; nodeScript: string } | null>(null);
  const [activeTab, setActiveTab] = useState<'webhook' | 'github' | 'node' | 'curl'>('webhook');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/export-script')
      .then((res) => res.json())
      .then((json) => setData(json))
      .catch((err) => console.error('Error fetching export script:', err));
  }, [settings.targetTweetId]);

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1800);
  };

  const currentOrigin = typeof window !== 'undefined' ? window.location.origin : '';
  const webhookUrl = `${currentOrigin}/api/cron/trigger?secret=${encodeURIComponent(settings.webhookSecret || 'chroma_auto_secret')}`;

  const curlSnippet = `curl -X POST https://api.x.com/2/tweets \\
  -H "Authorization: Bearer YOUR_TWITTER_BEARER_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "text": "🎨 6:00 AM Color Drop: Aurora Mint (#6EE7B7)\\nRGB: 110, 231, 183\\n\\n#ColorPalette",
    "reply": {
      "in_reply_to_tweet_id": "${settings.targetTweetId}"
    }
  }'`;

  return (
    <div className="max-w-4xl space-y-6">
      <div className="pb-4 border-b border-neutral-200 dark:border-neutral-800">
        <h2 className="text-xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
          Autonomous Automation & Ping Triggers
        </h2>
        <p className="text-sm text-neutral-500 mt-0.5">
          Run your scheduled color replies 100% autonomously in the cloud forever at zero cost, without GitHub Actions auth friction.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 p-1 bg-neutral-100 dark:bg-neutral-900 rounded-lg text-xs w-fit">
        <button
          onClick={() => setActiveTab('webhook')}
          className={`px-3 py-1.5 font-medium rounded-md transition-colors cursor-pointer flex items-center gap-1.5 ${
            activeTab === 'webhook'
              ? 'bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 shadow-xs'
              : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200'
          }`}
        >
          <Globe className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
          Autonomous Webhook (Recommended)
        </button>

        <button
          onClick={() => setActiveTab('github')}
          className={`px-3 py-1.5 font-medium rounded-md transition-colors cursor-pointer ${
            activeTab === 'github'
              ? 'bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 shadow-xs'
              : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200'
          }`}
        >
          GitHub Actions Workflow
        </button>

        <button
          onClick={() => setActiveTab('node')}
          className={`px-3 py-1.5 font-medium rounded-md transition-colors cursor-pointer ${
            activeTab === 'node'
              ? 'bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 shadow-xs'
              : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200'
          }`}
        >
          Node.js Standalone
        </button>

        <button
          onClick={() => setActiveTab('curl')}
          className={`px-3 py-1.5 font-medium rounded-md transition-colors cursor-pointer ${
            activeTab === 'curl'
              ? 'bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 shadow-xs'
              : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200'
          }`}
        >
          Raw cURL
        </button>
      </div>

      {/* Tab 1: Webhook Trigger (Zero Auth Pain) */}
      {activeTab === 'webhook' && (
        <div className="space-y-4">
          <div className="border border-neutral-200 dark:border-neutral-800 rounded-xl p-5 bg-white dark:bg-neutral-900 text-xs text-neutral-600 dark:text-neutral-400 leading-relaxed shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-sm text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-500" />
                Zero-Cost Cloud Automation: Free Webhook Ping
              </h3>
              <span className="bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-semibold px-2 py-0.5 rounded border border-emerald-200 dark:border-emerald-800">
                100% Free • $0/mo
              </span>
            </div>

            <p>
              Since this web application already has your working Twitter credentials securely saved in its database, you do not need to configure GitHub Actions secrets or deal with OAuth token permission mismatches.
            </p>

            <div className="p-3.5 bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 rounded-lg space-y-2">
              <span className="font-semibold text-neutral-900 dark:text-neutral-100 block">
                How to set this up in 30 seconds:
              </span>
              <ol className="list-decimal pl-5 space-y-1.5 text-neutral-600 dark:text-neutral-400">
                <li>
                  Sign up for free at{' '}
                  <a href="https://cron-job.org" target="_blank" rel="noreferrer" className="text-blue-600 dark:text-blue-400 font-semibold underline">
                    cron-job.org
                  </a>{' '}
                  or{' '}
                  <a href="https://uptimerobot.com" target="_blank" rel="noreferrer" className="text-blue-600 dark:text-blue-400 font-semibold underline">
                    UptimeRobot
                  </a>
                  .
                </li>
                <li>
                  Create a new recurring monitor/cron job.
                </li>
                <li>
                  Paste your <strong>One-Click Autonomous URL</strong> below.
                </li>
                <li>
                  Choose your schedule: <em>Every 1 minute, every 15m, 30m, 60m, 3h, 6h, 12h, or daily at 6am & 6pm</em>.
                </li>
              </ol>
            </div>
          </div>

          <div className="border border-neutral-200 dark:border-neutral-800 rounded-xl overflow-hidden bg-neutral-950 shadow-xs">
            <div className="flex items-center justify-between px-4 py-2.5 bg-neutral-900 border-b border-neutral-800 text-xs">
              <span className="font-mono text-neutral-400">Autonomous Webhook URL (GET or POST)</span>
              <button
                onClick={() => copyToClipboard(webhookUrl, 'webhook')}
                className="px-2.5 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-mono flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                {copiedKey === 'webhook' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedKey === 'webhook' ? 'Copied URL' : 'Copy URL'}
              </button>
            </div>
            <pre className="p-4 text-xs font-mono text-emerald-400 overflow-x-auto leading-relaxed whitespace-pre-wrap break-all">
              {webhookUrl}
            </pre>
          </div>
        </div>
      )}

      {/* Tab 2: GitHub Actions */}
      {activeTab === 'github' && (
        <div className="space-y-4">
          <div className="border border-neutral-200 dark:border-neutral-800 rounded-xl p-5 bg-white dark:bg-neutral-900 text-xs text-neutral-600 dark:text-neutral-400 leading-relaxed shadow-xs">
            <h3 className="font-bold text-sm text-neutral-900 dark:text-neutral-100 mb-1">
              GitHub Actions Cron Runner
            </h3>
            <p>
              Runs inside GitHub's free runners. Requires valid `Read and Write` Twitter API keys placed in your GitHub Repository Secrets.
            </p>
          </div>

          <div className="border border-neutral-200 dark:border-neutral-800 rounded-xl overflow-hidden bg-neutral-950 shadow-xs">
            <div className="flex items-center justify-between px-4 py-2.5 bg-neutral-900 border-b border-neutral-800 text-xs">
              <span className="font-mono text-neutral-400">.github/workflows/chromabot.yml</span>
              <button
                onClick={() => copyToClipboard(data?.githubActionsYaml || '', 'yaml')}
                className="px-2.5 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-mono flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                {copiedKey === 'yaml' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedKey === 'yaml' ? 'Copied YAML' : 'Copy Workflow'}
              </button>
            </div>
            <pre className="p-4 text-xs font-mono text-neutral-300 overflow-x-auto leading-relaxed">
              {data?.githubActionsYaml}
            </pre>
          </div>
        </div>
      )}

      {/* Tab 3: Node.js runner */}
      {activeTab === 'node' && (
        <div className="space-y-4">
          <div className="border border-neutral-200 dark:border-neutral-800 rounded-xl p-5 bg-white dark:bg-neutral-900 text-xs text-neutral-600 dark:text-neutral-400 leading-relaxed shadow-xs">
            <h3 className="font-bold text-sm text-neutral-900 dark:text-neutral-100 mb-1">
              Self-Contained ES Module Runner
            </h3>
            <p>
              This standalone script has zero external dependencies (uses native Node.js crypto and fetch). Run it via crontab, Raspberry Pi, or Cloud Run.
            </p>
          </div>

          <div className="border border-neutral-200 dark:border-neutral-800 rounded-xl overflow-hidden bg-neutral-950 shadow-xs">
            <div className="flex items-center justify-between px-4 py-2.5 bg-neutral-900 border-b border-neutral-800 text-xs">
              <span className="font-mono text-neutral-400">standalone-poster.mjs</span>
              <button
                onClick={() => copyToClipboard(data?.nodeScript || '', 'node')}
                className="px-2.5 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-mono flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                {copiedKey === 'node' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedKey === 'node' ? 'Copied Script' : 'Copy Script'}
              </button>
            </div>
            <pre className="p-4 text-xs font-mono text-neutral-300 overflow-x-auto leading-relaxed">
              {data?.nodeScript}
            </pre>
          </div>
        </div>
      )}

      {/* Tab 4: cURL Command */}
      {activeTab === 'curl' && (
        <div className="space-y-4">
          <div className="border border-neutral-200 dark:border-neutral-800 rounded-xl p-5 bg-white dark:bg-neutral-900 text-xs text-neutral-600 dark:text-neutral-400 leading-relaxed shadow-xs">
            <h3 className="font-bold text-sm text-neutral-900 dark:text-neutral-100 mb-1">
              Terminal Verification Command
            </h3>
            <p>
              Execute a direct reply to tweet <code className="font-mono text-neutral-900 dark:text-neutral-100">#{settings.targetTweetId}</code> using raw cURL with an OAuth 2.0 Bearer token.
            </p>
          </div>

          <div className="border border-neutral-200 dark:border-neutral-800 rounded-xl overflow-hidden bg-neutral-950 shadow-xs">
            <div className="flex items-center justify-between px-4 py-2.5 bg-neutral-900 border-b border-neutral-800 text-xs">
              <span className="font-mono text-neutral-400">curl-reply.sh</span>
              <button
                onClick={() => copyToClipboard(curlSnippet, 'curl')}
                className="px-2.5 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-mono flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                {copiedKey === 'curl' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedKey === 'curl' ? 'Copied cURL' : 'Copy Command'}
              </button>
            </div>
            <pre className="p-4 text-xs font-mono text-neutral-300 overflow-x-auto leading-relaxed">
              {curlSnippet}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
};
