/**
 * X ChromaBot - TwitterSetup ("API Keys" tab)
 * The X app's own keys: API key + secret (needed to connect accounts and to sign as them) and an
 * optional app-only bearer token (used to read X trends). Accounts themselves are connected under
 * Settings → X accounts; there are no user tokens here.
 */

import React, { useState } from 'react';
import { AlertCircle, CheckCircle2, ExternalLink, Key, Shield } from 'lucide-react';
import { CredentialsStatus } from '../types.js';
import type { CredentialsResult } from '../hooks/useCredentials.js';

interface TwitterSetupProps {
  credentialsStatus: CredentialsStatus | null;
  onSaveCredentials: (creds: Record<string, string>) => Promise<CredentialsResult>;
  onClearCredentials: (method: 'app' | 'bearer') => Promise<CredentialsResult>;
}

const FIELD =
  'w-full px-3 py-2 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-xs font-mono disabled:opacity-50';
const LABEL = 'font-semibold text-neutral-700 dark:text-neutral-300';

export const TwitterSetup: React.FC<TwitterSetupProps> = ({
  credentialsStatus: status,
  onSaveCredentials,
  onClearCredentials,
}) => {
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [bearerToken, setBearerToken] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const canSave = status?.canPersistCredentials !== false;

  const save = async () => {
    const fields = Object.fromEntries(
      Object.entries({ apiKey, apiSecret, bearerToken }).filter(([, v]) => v.trim()),
    );
    if (!Object.keys(fields).length) {
      setMessage({
        ok: false,
        text: 'Enter at least one value (blank fields keep the stored one).',
      });
      return;
    }
    const r = await onSaveCredentials(fields);
    setMessage(
      r.success ? { ok: true, text: 'Saved.' } : { ok: false, text: r.error || 'Not saved.' },
    );
    if (r.success) {
      setApiKey('');
      setApiSecret('');
      setBearerToken('');
    }
  };

  const clear = async (method: 'app' | 'bearer') => {
    const r = await onClearCredentials(method);
    setMessage(
      r.success ? { ok: true, text: 'Removed.' } : { ok: false, text: r.error || 'Failed.' },
    );
  };

  return (
    <div className="space-y-4 max-w-2xl">
      <section className="border border-neutral-200 dark:border-neutral-800 rounded-xl p-5 bg-white dark:bg-neutral-900 space-y-3 shadow-xs text-xs">
        <h2 className="text-sm font-bold text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
          <Key className="w-4 h-4 text-indigo-500" /> Twitter / X Developer Account Integration
        </h2>
        <p className="text-neutral-500 leading-relaxed">
          These are your X app&apos;s keys from the{' '}
          <a
            href="https://developer.x.com/en/portal/dashboard"
            target="_blank"
            rel="noreferrer"
            className="underline inline-flex items-center gap-0.5"
          >
            developer portal <ExternalLink className="w-3 h-3" />
          </a>{' '}
          (Keys and Tokens). The accounts that post are connected under <b>Settings → X accounts</b>
          ; each keeps its own tokens there.
        </p>
        <p data-testid="app-keys-status" className="flex items-center gap-1.5 font-medium">
          {status?.isFullyConfigured ? (
            <>
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> App keys set
              {status.source === 'environment_variables' ? ' (from environment variables)' : ''}
            </>
          ) : (
            <>
              <AlertCircle className="w-3.5 h-3.5 text-amber-500" /> App keys missing: accounts
              cannot be connected
            </>
          )}
        </p>
        {!canSave && (
          <p className="flex items-start gap-1.5 text-amber-700 dark:text-amber-400">
            <Shield className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            Saving keys from this form is disabled: CREDENTIALS_ENCRYPTION_KEY is not set on the
            server. Provide them as environment variables (TWITTER_API_KEY, TWITTER_API_SECRET,
            TWITTER_BEARER_TOKEN) instead.
          </p>
        )}

        <label className="block space-y-1">
          <span className={LABEL}>API Key (consumer key)</span>
          <input
            className={FIELD}
            value={apiKey}
            disabled={!canSave}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={status?.apiKeyMasked || 'Enter API Key...'}
          />
        </label>
        <label className="block space-y-1">
          <span className={LABEL}>API Key Secret (consumer secret)</span>
          <input
            type="password"
            className={FIELD}
            value={apiSecret}
            disabled={!canSave}
            onChange={(e) => setApiSecret(e.target.value)}
            placeholder={status?.hasApiSecret ? '••••' : 'Enter API Key Secret...'}
          />
        </label>
        <label className="block space-y-1">
          <span className={LABEL}>Bearer Token (optional, app-only: reads X trends)</span>
          <input
            type="password"
            className={FIELD}
            value={bearerToken}
            disabled={!canSave}
            onChange={(e) => setBearerToken(e.target.value)}
            placeholder={status?.bearerTokenMasked || 'Enter Bearer Token...'}
          />
        </label>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={save}
            disabled={!canSave}
            className="px-3 py-1.5 rounded-lg font-semibold text-white bg-indigo-600 hover:bg-indigo-700 cursor-pointer disabled:opacity-50"
          >
            Save App Keys
          </button>
          {status?.source === 'server_config' && (
            <>
              <button
                type="button"
                onClick={() => clear('app')}
                className="px-3 py-1.5 rounded-lg text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer"
              >
                Remove saved API key
              </button>
              {status.hasBearerToken && (
                <button
                  type="button"
                  onClick={() => clear('bearer')}
                  className="px-3 py-1.5 rounded-lg text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer"
                >
                  Remove saved bearer token
                </button>
              )}
            </>
          )}
          {message && (
            <span
              className={message.ok ? 'text-emerald-600' : 'text-red-600 dark:text-red-400'}
              role="status"
            >
              {message.text}
            </span>
          )}
        </div>
      </section>
    </div>
  );
};
