/**
 * X ChromaBot - RunToggles
 * The GLOBAL safety switches (same state as the header pills and the status bar "Pause all"),
 * applied immediately. Per-campaign scheduling and dry run live on each campaign card.
 */

import React from 'react';

interface RunTogglesProps {
  globalDryRun: boolean;
  globalPaused: boolean;
  onToggleGlobalDryRun: () => void;
  onToggleGlobalPause: () => void;
}

interface SwitchProps {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

const Switch: React.FC<SwitchProps> = ({ label, hint, checked, onChange }) => (
  <label className="flex items-start gap-3 cursor-pointer">
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="mt-1 h-4 w-4 rounded border-neutral-300 text-neutral-900 focus:ring-neutral-500"
    />
    <div>
      <div className="font-semibold text-sm text-neutral-900 dark:text-neutral-100">{label}</div>
      <p className="text-xs text-neutral-500">{hint}</p>
    </div>
  </label>
);

export const RunToggles: React.FC<RunTogglesProps> = (props) => (
  <section
    aria-label="All campaigns"
    className="border border-neutral-200 dark:border-neutral-800 rounded-xl p-5 bg-white dark:bg-neutral-900 space-y-3 shadow-xs"
  >
    <div>
      <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-700 dark:text-neutral-300">
        All campaigns
      </h3>
      <p className="text-xs text-neutral-500">
        Global safety switches, also in the header and status bar. They override every campaign and
        apply immediately. Each campaign's own schedule and dry run are on its card.
      </p>
    </div>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Switch
        label="Global dry run"
        hint="Simulates every post from every campaign; nothing is sent to X."
        checked={props.globalDryRun}
        onChange={props.onToggleGlobalDryRun}
      />
      <Switch
        label="Pause all campaigns"
        hint="Stops all scheduled drops. Manual posts still work."
        checked={props.globalPaused}
        onChange={props.onToggleGlobalPause}
      />
    </div>
  </section>
);
