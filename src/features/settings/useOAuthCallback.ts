/**
 * X ChromaBot - useOAuthCallback
 * X redirects the browser to /oauth/x/callback?oauth_token=..&oauth_verifier=.. after the owner
 * approves the app (the server serves the SPA there). This finishes the connection through the
 * authenticated API, cleans the URL and opens Settings.
 */

import { useEffect, useRef } from 'react';
import { completeAccountConnect } from '../../api/endpoints.js';
import { toast } from '../../components/ui/toastStore.js';
import { OAUTH_CALLBACK_PATH } from './useAccounts.js';

export function useOAuthCallback(onHandled: () => void, onConnected: () => Promise<void> | void) {
  const done = useRef(false);
  const handlers = useRef({ onHandled, onConnected });
  handlers.current = { onHandled, onConnected };

  useEffect(() => {
    if (done.current || window.location.pathname !== OAUTH_CALLBACK_PATH) return;
    done.current = true;
    const params = new URLSearchParams(window.location.search);
    const oauthToken = params.get('oauth_token');
    const verifier = params.get('oauth_verifier');
    // Never leave the verifier in the address bar or history.
    window.history.replaceState(null, '', '/');
    handlers.current.onHandled();
    if (!oauthToken || !verifier) {
      toast.error('X authorization was cancelled. No account was connected.');
      return;
    }
    completeAccountConnect({ oauthToken, verifier })
      .then(async (r) => {
        toast.success(`Connected @${r.account.handle}`);
        await handlers.current.onConnected();
      })
      .catch(() => {
        // apiFetch already showed the error
      });
  }, []);
}
