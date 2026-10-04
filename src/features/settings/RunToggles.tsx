/**
 * X ChromaBot - RunToggles
 * Scheduler on/off and dry-run simulation switches.
 */

import React from 'react';

interface RunTogglesProps {
  schedulerEnabled: boolean;
  dryRun: boolean;
  onChange: (patch: { schedulerEnabled?: boolean; dryRun?: boolean }) => void;
}

export const RunToggles: React.FC<RunTogglesProps> = ({ schedulerEnabled, dryRun, onChange }) => (
  <div className="border border-neutral-200 dark:border-neutral-800 rounded-xl p-5 bg-white dark:bg-neutral-900 grid grid-cols-1 md:grid-cols-2 gap-4 shadow-xs">
    <label className="flex items-start gap-3 cursor-pointer">
      <input
        type="checkbox"
        checked={schedulerEnabled}
        onChange={(e) => onChange({ schedulerEnabled: e.target.checked })}
        className="mt-1 h-4 w-4 rounded border-neutral-300 text-neutral-900 focus:ring-neutral-500"
      />
      <div>
        <div className="font-semibold text-sm text-neutral-900 dark:text-neutral-100">
          Automated Background Scheduler
        </div>
        <p className="text-xs text-neutral-500">
          When active, the server monitors interval or clock ticks and automatically fires replies.
        </p>
      </div>
    </label>

    <label className="flex items-start gap-3 cursor-pointer">
      <input
        type="checkbox"
        checked={dryRun}
        onChange={(e) => onChange({ dryRun: e.target.checked })}
        className="mt-1 h-4 w-4 rounded border-neutral-300 text-neutral-900 focus:ring-neutral-500"
      />
      <div>
        <div className="font-semibold text-sm text-neutral-900 dark:text-neutral-100">
          Dry Run Simulation Mode
        </div>
        <p className="text-xs text-neutral-500">
          Simulates posts locally without consuming X API monthly tweet quotas.
        </p>
      </div>
    </label>
  </div>
);
