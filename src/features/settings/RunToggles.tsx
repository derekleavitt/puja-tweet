/**
 * X ChromaBot - RunToggles
 * Two clearly separated scopes: the GLOBAL switches (same state as the header pills and the status
 * bar "Pause all", applied immediately) and the active campaign's own scheduler / dry-run switches
 * (saved with the form).
 */

import React from 'react';

interface RunTogglesProps {
  campaignName?: string;
  schedulerEnabled: boolean;
  dryRun: boolean;
  onChange: (patch: { schedulerEnabled?: boolean; dryRun?: boolean }) => void;
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

const SCOPE_TITLE =
  'text-xs font-bold uppercase tracking-wider text-neutral-700 dark:text-neutral-300';

export const RunToggles: React.FC<RunTogglesProps> = (props) => (
  <div className="border border-neutral-200 dark:border-neutral-800 rounded-xl p-5 bg-white dark:bg-neutral-900 space-y-5 shadow-xs">
    <section aria-label="All campaigns" className="space-y-3">
      <div>
        <h3 className={SCOPE_TITLE}>All campaigns</h3>
        <p className="text-xs text-neutral-500">
          Global safety switches, also in the header and status bar. They override every campaign
          and apply immediately.
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

    <section
      aria-label="This campaign"
      className="space-y-3 pt-5 border-t border-neutral-100 dark:border-neutral-800/80"
    >
      <div>
        <h3 className={SCOPE_TITLE}>
          This campaign{props.campaignName ? `: ${props.campaignName}` : ''}
        </h3>
        <p className="text-xs text-neutral-500">
          Applies to the active campaign only and is saved with Save Settings. The global switches
          above take precedence.
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Switch
          label="Campaign scheduler"
          hint="When active, the server fires this campaign automatically on its schedule."
          checked={props.schedulerEnabled}
          onChange={(schedulerEnabled) => props.onChange({ schedulerEnabled })}
        />
        <Switch
          label="Campaign dry run"
          hint="Simulates this campaign's posts without using X API quota."
          checked={props.dryRun}
          onChange={(dryRun) => props.onChange({ dryRun })}
        />
      </div>
    </section>
  </div>
);
