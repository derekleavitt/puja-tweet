/**
 * X ChromaBot - useCredentials
 * Save / verify X API credentials.
 */

import { clearCredentials, saveCredentials, verifyCredentials } from '../api/endpoints.js';
import { CredentialsStatus } from '../types.js';

export interface CredentialsResult {
  success: boolean;
  error?: string;
}

interface UseCredentialsDeps {
  setCredentialsStatus: (status: CredentialsStatus | null) => void;
  fetchStatus: () => Promise<void>;
}

export function useCredentials({ setCredentialsStatus, fetchStatus }: UseCredentialsDeps) {
  // Save credentials
  const handleSaveCredentials = async (creds: any): Promise<CredentialsResult> => {
    const data = await saveCredentials(creds);
    if (data?.success) {
      setCredentialsStatus(data.credentialsStatus);
      fetchStatus();
    }
    return { success: !!data?.success, error: data?.error };
  };

  // Remove the stored credentials of one auth method
  const handleClearCredentials = async (
    method: 'oauth1' | 'oauth2' | 'bearer',
  ): Promise<CredentialsResult> => {
    const data = await clearCredentials(method);
    if (data?.success) {
      setCredentialsStatus(data.credentialsStatus);
      fetchStatus();
    }
    return { success: !!data?.success, error: data?.error };
  };

  // Verify credentials
  const handleVerifyCredentials = async () => {
    return await verifyCredentials();
  };

  return { handleSaveCredentials, handleClearCredentials, handleVerifyCredentials };
}
