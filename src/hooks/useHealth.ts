/**
 * X ChromaBot - useHealth
 * Reads the server's /api/health once so the UI can say which store it is running on.
 */

import { useEffect, useState } from 'react';
import { getHealth } from '../api/endpoints.js';
import { HealthInfo } from '../types.js';

export function useHealth(): HealthInfo | null {
  const [health, setHealth] = useState<HealthInfo | null>(null);
  useEffect(() => {
    let cancelled = false;
    getHealth()
      .then((data) => {
        if (!cancelled) setHealth(data);
      })
      .catch(() => {
        // Footer falls back to neutral copy when the health probe is unreachable.
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return health;
}
