/**
 * X ChromaBot - Clean unboxed footer
 */

import React from 'react';
import { DEV_AUTH_BYPASS } from '../lib/devAuth.js';
import { HealthInfo } from '../types.js';

interface FooterProps {
  campaignCount: number;
  /** From /api/health; null until loaded or when unreachable. */
  health?: HealthInfo | null;
}

const STORE_LABELS: Record<NonNullable<HealthInfo['store']>, string> = {
  firestore: 'Cloud Firestore state',
  json: 'Local file state',
  memory: 'In-memory state (not persisted)',
};

/** Accurate environment line: dev bypass, else the real store kind, else neutral copy. */
function environmentLabel(health?: HealthInfo | null): string {
  if (DEV_AUTH_BYPASS) return 'Dev mode — auth bypassed';
  const store = health?.store ? STORE_LABELS[health.store] : null;
  return store ? `${store} · Google sign-in` : 'Google sign-in';
}

export const Footer: React.FC<FooterProps> = ({ campaignCount, health }) => {
  return (
    <footer className="border-t border-neutral-200 dark:border-neutral-800 py-6 px-6 text-xs text-neutral-500 bg-white dark:bg-neutral-950">
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-neutral-700 dark:text-neutral-300">X ChromaBot</span>
          <span>·</span>
          <span>Campaigns: {campaignCount}</span>
        </div>
        <div className="flex items-center gap-4 text-neutral-400 font-mono text-[11px]">
          <span data-testid="footer-env">{environmentLabel(health)}</span>
          <span>·</span>
          <span>Multi-Schedule Context Engine</span>
        </div>
      </div>
    </footer>
  );
};
