/**
 * X ChromaBot - useCredentials
 * Save / verify X API credentials.
 */

import { saveCredentials, verifyCredentials } from '../api/endpoints.js';
import { CredentialsStatus } from '../types.js';

interface UseCredentialsDeps {
  setCredentialsStatus: (status: CredentialsStatus | null) => void;
  fetchStatus: () => Promise<void>;
}

export function useCredentials({ setCredentialsStatus, fetchStatus }: UseCredentialsDeps) {
  // Save credentials
  const handleSaveCredentials = async (creds: any) => {
    const data = await saveCredentials(creds);
    if (data) {
      setCredentialsStatus(data.credentialsStatus);
      fetchStatus();
    }
  };

  // Verify credentials
  const handleVerifyCredentials = async () => {
    return await verifyCredentials();
  };

  return { handleSaveCredentials, handleVerifyCredentials };
}
