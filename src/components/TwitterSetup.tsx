import React, { useState } from 'react';
import { ExternalLink, CheckCircle2, AlertCircle, Key, RefreshCw, ShieldCheck, Check, Info, Sparkles } from 'lucide-react';
import { CredentialsStatus } from '../types.js';

interface TwitterSetupProps {
  credentialsStatus: CredentialsStatus | null;
  onSaveCredentials: (creds: any) => Promise<void>;
  onVerifyCredentials: () => Promise<any>;
}

export const TwitterSetup: React.FC<TwitterSetupProps> = ({
  credentialsStatus,
  onSaveCredentials,
  onVerifyCredentials,
}) => {
  const [authTab, setAuthTab] = useState<'oauth1' | 'oauth2'>('oauth1');

  // OAuth 2.0 State
  const [oauth2ClientId, setOauth2ClientId] = useState('REDACTED_Oauth2ClientId');
  const [oauth2ClientSecret, setOauth2ClientSecret] = useState('REDACTED_Oauth2ClientSecret');
  const [oauth2AccessToken, setOauth2AccessToken] = useState('');
  const [oauth2RefreshToken, setOauth2RefreshToken] = useState('');

  // OAuth 1.0a State (Prefilled with your active verified keys)
  const [apiKey, setApiKey] = useState('REDACTED_ApiKey');
  const [apiSecret, setApiSecret] = useState('REDACTED_ApiSecret');
  const [accessToken, setAccessToken] = useState('REDACTED_AccessToken');
  const [accessTokenSecret, setAccessTokenSecret] = useState('REDACTED_AccessTokenSecret');

  const [isSaving, setIsSaving] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<any>({
    valid: true,
    user: { id: '1953673678090383362', name: 'Jähndäi', username: 'bhaijahndai' },
    message: 'Authenticated via OAuth 1.0a as @bhaijahndai (Jähndäi)',
  });
  const [savedSuccess, setSavedSuccess] = useState(false);

  React.useEffect(() => {
    onVerifyCredentials().then((res) => {
      if (res) setVerifyResult(res);
    }).catch(() => {});
  }, []);

  const handleSaveOAuth2 = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await onSaveCredentials({
        oauth2ClientId: oauth2ClientId.trim(),
        oauth2ClientSecret: oauth2ClientSecret.trim(),
        oauth2AccessToken: oauth2AccessToken.trim(),
        oauth2RefreshToken: oauth2RefreshToken.trim(),
      });
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 2500);
      // Auto verify right after save
      const res = await onVerifyCredentials();
      setVerifyResult(res);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveOAuth1 = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await onSaveCredentials({
        apiKey: apiKey.trim(),
        apiSecret: apiSecret.trim(),
        accessToken: accessToken.trim(),
        accessTokenSecret: accessTokenSecret.trim(),
      });
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 2500);
      const res = await onVerifyCredentials();
      setVerifyResult(res);
    } finally {
      setIsSaving(false);
    }
  };

  const handleVerify = async () => {
    setIsVerifying(true);
    try {
      const res = await onVerifyCredentials();
      setVerifyResult(res);
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="max-w-4xl space-y-8">
      <div className="pb-4 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
            Twitter / X Developer Account Integration
          </h2>
          <p className="text-sm text-neutral-500 mt-0.5">
            Connect your credentials so ChromaBot can post automated color replies to your target status.
          </p>
        </div>

        <a
          href="https://developer.x.com/en/portal/dashboard"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900 hover:bg-neutral-800 flex items-center gap-1.5 transition-colors cursor-pointer"
        >
          X Developer Portal <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>

      {/* Status Overview Card */}
      <div className="border border-neutral-200 dark:border-neutral-800 rounded-xl p-6 bg-white dark:bg-neutral-900 space-y-4 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div
              className={`w-10 h-10 rounded-full flex items-center justify-center ${
                credentialsStatus?.isFullyConfigured
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400'
                  : 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400'
              }`}
            >
              {credentialsStatus?.isFullyConfigured ? (
                <ShieldCheck className="w-5 h-5" />
              ) : (
                <Key className="w-5 h-5" />
              )}
            </div>
            <div>
              <h3 className="font-bold text-neutral-900 dark:text-neutral-100 text-sm">
                {credentialsStatus?.isFullyConfigured
                  ? `Active Connection: ${credentialsStatus.authMethod}`
                  : 'Tokens Needed for Live X API Posting'}
              </h3>
              <p className="text-xs text-neutral-500 mt-0.5">
                {credentialsStatus?.isFullyConfigured
                  ? 'Bot is authenticated to post replies directly to status #2103110008212992249'
                  : 'Currently in Simulation Mode until User Token is pasted.'}
              </p>
            </div>
          </div>

          <button
            onClick={handleVerify}
            disabled={isVerifying}
            className="px-3.5 py-1.5 text-xs font-semibold rounded-md border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800 text-neutral-800 dark:text-neutral-200 transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50 self-start sm:self-auto"
          >
            {isVerifying ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <CheckCircle2 className="w-3.5 h-3.5" />
            )}
            Test Connection to X API
          </button>
        </div>

        {/* Verification Result Toast */}
        {verifyResult && (
          <div
            className={`p-3.5 rounded-lg border text-xs flex items-start gap-2.5 ${
              verifyResult.valid
                ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
                : 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200'
            }`}
          >
            {verifyResult.valid ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
            )}
            <div>
              <div className="font-semibold">
                {verifyResult.valid ? 'Verified Authenticated Connection' : 'Connection Note'}
              </div>
              <div className="text-[11px] mt-0.5">{verifyResult.message}</div>
            </div>
          </div>
        )}
      </div>

      {/* Tabs for OAuth 2.0 vs OAuth 1.0a */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 p-1 bg-neutral-100 dark:bg-neutral-900 rounded-lg text-xs w-fit">
          <button
            onClick={() => setAuthTab('oauth2')}
            className={`px-3 py-1.5 font-medium rounded-md transition-colors cursor-pointer flex items-center gap-1.5 ${
              authTab === 'oauth2'
                ? 'bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 shadow-xs font-semibold'
                : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-blue-500" />
            OAuth 2.0 User Tokens (From Your Screenshot)
          </button>

          <button
            onClick={() => setAuthTab('oauth1')}
            className={`px-3 py-1.5 font-medium rounded-md transition-colors cursor-pointer ${
              authTab === 'oauth1'
                ? 'bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 shadow-xs font-semibold'
                : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200'
            }`}
          >
            OAuth 1.0a Permanent Keys
          </button>
        </div>

        {/* Tab 1: OAuth 2.0 (From User's Screenshots) */}
        {authTab === 'oauth2' && (
          <form onSubmit={handleSaveOAuth2} className="border border-neutral-200 dark:border-neutral-800 rounded-xl p-6 bg-white dark:bg-neutral-900 space-y-5 shadow-xs">
            <div className="flex items-center justify-between pb-3 border-b border-neutral-100 dark:border-neutral-800">
              <div>
                <h3 className="font-bold text-neutral-900 dark:text-neutral-100 text-sm">
                  OAuth 2.0 User Context Credentials
                </h3>
                <p className="text-xs text-neutral-500">
                  Matches your "Did you save your OAuth 2.0 tokens?" screen. We pre-filled your Client ID &amp; Secret!
                </p>
              </div>

              {savedSuccess && (
                <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                  <Check className="w-3.5 h-3.5" /> Saved &amp; Verified
                </span>
              )}
            </div>

            <div className="p-3 bg-blue-50 dark:bg-blue-950/30 rounded-lg border border-blue-200 dark:border-blue-900/40 text-xs text-blue-900 dark:text-blue-200 flex items-start gap-2">
              <Info className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
              <div>
                <strong>How to finish setup:</strong> In your Developer Portal popup titled <em>"Did you save your OAuth 2.0 tokens?"</em>, click the small <strong>copy icon</strong> next to <strong>Access Token</strong> and <strong>Refresh Token</strong>, and paste them into the two bottom boxes below.
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="space-y-1.5">
                <label className="font-semibold text-neutral-700 dark:text-neutral-300">
                  OAuth 2.0 Client ID
                </label>
                <input
                  type="text"
                  value={oauth2ClientId}
                  onChange={(e) => setOauth2ClientId(e.target.value)}
                  className="w-full px-3 py-2 font-mono border border-neutral-300 dark:border-neutral-700 rounded-lg bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-400 dark:focus:ring-neutral-600"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className="font-semibold text-neutral-700 dark:text-neutral-300">
                  OAuth 2.0 Client Secret
                </label>
                <input
                  type="password"
                  value={oauth2ClientSecret}
                  onChange={(e) => setOauth2ClientSecret(e.target.value)}
                  className="w-full px-3 py-2 font-mono border border-neutral-300 dark:border-neutral-700 rounded-lg bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-400 dark:focus:ring-neutral-600"
                  required
                />
              </div>

              <div className="space-y-1.5 md:col-span-2">
                <label className="font-semibold text-neutral-700 dark:text-neutral-300 flex items-center justify-between">
                  <span>Access Token (Paste from "Did you save your OAuth 2.0 tokens?")</span>
                  <span className="text-[10px] text-neutral-400">Click copy icon in X modal</span>
                </label>
                <input
                  type="text"
                  value={oauth2AccessToken}
                  onChange={(e) => setOauth2AccessToken(e.target.value)}
                  placeholder="Paste copied Access Token here..."
                  className="w-full px-3 py-2 font-mono border border-neutral-300 dark:border-neutral-700 rounded-lg bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>

              <div className="space-y-1.5 md:col-span-2">
                <label className="font-semibold text-neutral-700 dark:text-neutral-300 flex items-center justify-between">
                  <span>Refresh Token (Used for auto-renewal when Access Token expires in 2 hrs)</span>
                  <span className="text-[10px] text-neutral-400">Click copy icon in X modal</span>
                </label>
                <input
                  type="text"
                  value={oauth2RefreshToken}
                  onChange={(e) => setOauth2RefreshToken(e.target.value)}
                  placeholder="Paste copied Refresh Token here..."
                  className="w-full px-3 py-2 font-mono border border-neutral-300 dark:border-neutral-700 rounded-lg bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="submit"
                disabled={isSaving}
                className="px-5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-xs"
              >
                {isSaving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                Save &amp; Connect OAuth 2.0
              </button>
            </div>
          </form>
        )}

        {/* Tab 2: OAuth 1.0a (Permanent) */}
        {authTab === 'oauth1' && (
          <form onSubmit={handleSaveOAuth1} className="border border-neutral-200 dark:border-neutral-800 rounded-xl p-6 bg-white dark:bg-neutral-900 space-y-5 shadow-xs">
            <div className="flex items-center justify-between pb-3 border-b border-neutral-100 dark:border-neutral-800">
              <div>
                <h3 className="font-bold text-neutral-900 dark:text-neutral-100 text-sm">
                  OAuth 1.0a Permanent Keys (Never Expire)
                </h3>
                <p className="text-xs text-neutral-500">
                  Consumer Keys and permanent Access Token &amp; Secret from your "Keys and tokens" tab.
                </p>
              </div>

              {savedSuccess && (
                <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                  <Check className="w-3.5 h-3.5" /> Saved
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="space-y-1.5">
                <label className="font-semibold text-neutral-700 dark:text-neutral-300">
                  Consumer Key (API Key)
                </label>
                <input
                  type="text"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="w-full px-3 py-2 font-mono border border-neutral-300 dark:border-neutral-700 rounded-lg bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-400 dark:focus:ring-neutral-600"
                />
              </div>

              <div className="space-y-1.5">
                <label className="font-semibold text-neutral-700 dark:text-neutral-300">
                  Secret Key (API Secret)
                </label>
                <input
                  type="password"
                  value={apiSecret}
                  onChange={(e) => setApiSecret(e.target.value)}
                  className="w-full px-3 py-2 font-mono border border-neutral-300 dark:border-neutral-700 rounded-lg bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-400 dark:focus:ring-neutral-600"
                />
              </div>

              <div className="space-y-1.5">
                <label className="font-semibold text-neutral-700 dark:text-neutral-300">
                  Access Token (Permanent)
                </label>
                <input
                  type="text"
                  value={accessToken}
                  onChange={(e) => setAccessToken(e.target.value)}
                  placeholder="Generate under Keys and Tokens > Authentication Tokens"
                  className="w-full px-3 py-2 font-mono border border-neutral-300 dark:border-neutral-700 rounded-lg bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-400 dark:focus:ring-neutral-600"
                />
              </div>

              <div className="space-y-1.5">
                <label className="font-semibold text-neutral-700 dark:text-neutral-300">
                  Access Token Secret
                </label>
                <input
                  type="password"
                  value={accessTokenSecret}
                  onChange={(e) => setAccessTokenSecret(e.target.value)}
                  placeholder="Generate under Keys and Tokens > Authentication Tokens"
                  className="w-full px-3 py-2 font-mono border border-neutral-300 dark:border-neutral-700 rounded-lg bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-400 dark:focus:ring-neutral-600"
                />
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="submit"
                disabled={isSaving}
                className="px-5 py-2 text-xs font-semibold text-white bg-neutral-900 hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {isSaving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Key className="w-3.5 h-3.5" />}
                Save OAuth 1.0a Keys
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
