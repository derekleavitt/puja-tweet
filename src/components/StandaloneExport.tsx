import React, { useState, useEffect } from 'react';
import { Copy, Check, Terminal, ExternalLink, ArrowRight, Shield } from 'lucide-react';
import { BotSettings } from '../types.js';

interface StandaloneExportProps {
  settings: BotSettings;
}

export const StandaloneExport: React.FC<StandaloneExportProps> = ({ settings }) => {
  const [data, setData] = useState<{ githubActionsYaml: string; nodeScript: string } | null>(null);
  const [activeTab, setActiveTab] = useState<'github' | 'node' | 'curl'>('github');
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
          Autonomous Cloud Runner & GitHub Actions
        </h2>
        <p className="text-sm text-neutral-500 mt-0.5">
          Run your 6:00 AM & 6:00 PM automated color replies 100% autonomously in the cloud forever, even when this browser tab is closed.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 p-1 bg-neutral-100 dark:bg-neutral-900 rounded-lg text-xs w-fit">
        <button
          onClick={() => setActiveTab('github')}
          className={`px-3 py-1.5 font-medium rounded-md transition-colors cursor-pointer ${
            activeTab === 'github'
              ? 'bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 shadow-xs'
              : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200'
          }`}
        >
          GitHub Actions (Free Scheduled Cron)
        </button>

        <button
          onClick={() => setActiveTab('node')}
          className={`px-3 py-1.5 font-medium rounded-md transition-colors cursor-pointer ${
            activeTab === 'node'
              ? 'bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 shadow-xs'
              : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200'
          }`}
        >
          Standalone Node.js Runner
        </button>

        <button
          onClick={() => setActiveTab('curl')}
          className={`px-3 py-1.5 font-medium rounded-md transition-colors cursor-pointer ${
            activeTab === 'curl'
              ? 'bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 shadow-xs'
              : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200'
          }`}
        >
          Raw cURL Command
        </button>
      </div>

      {/* Tab 1: GitHub Actions */}
      {activeTab === 'github' && (
        <div className="space-y-4">
          <div className="border border-neutral-200 dark:border-neutral-800 rounded-xl p-5 bg-white dark:bg-neutral-900 text-xs text-neutral-600 dark:text-neutral-400 leading-relaxed shadow-xs">
            <h3 className="font-bold text-sm text-neutral-900 dark:text-neutral-100 mb-1">
              Zero-Server Setup using GitHub Actions
            </h3>
            <p>
              GitHub Actions has built-in cron scheduling that can trigger your script twice daily at 6:00 AM and 6:00 PM without needing an always-on server.
            </p>
            <ol className="list-decimal pl-5 mt-2 space-y-1 text-neutral-500">
              <li>Create a GitHub repository.</li>
              <li>Add this file at <code className="font-mono bg-neutral-100 dark:bg-neutral-800 px-1 py-0.5 rounded text-neutral-800 dark:text-neutral-200">.github/workflows/chromabot.yml</code></li>
              <li>Add your 4 Twitter API credentials under Repository Settings &gt; Secrets and variables &gt; Actions.</li>
              <li>Target Post is pre-configured to <code className="font-mono font-bold text-neutral-900 dark:text-neutral-100">#{settings.targetTweetId}</code>!</li>
            </ol>
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

      {/* Tab 2: Node.js runner */}
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

      {/* Tab 3: cURL Command */}
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
