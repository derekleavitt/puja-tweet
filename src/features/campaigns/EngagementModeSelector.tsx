/**
 * X ChromaBot - EngagementModeSelector
 * Form control: Direct Reply vs Quote Tweet vs Timeline Drop.
 */

import React from 'react';
import { MessageSquare, Quote, Globe } from 'lucide-react';
import { TweetContext } from '../../types.js';
import { LABEL_CLASS, OPTION_BASE_CLASS, OPTION_IDLE_CLASS } from './constants.js';

type Mode = NonNullable<TweetContext['engagementMode']>;

interface EngagementModeSelectorProps {
  value?: TweetContext['engagementMode'];
  onChange: (mode: Mode) => void;
}

const OPTIONS: {
  mode: Mode;
  label: string;
  hint: string;
  Icon: typeof Quote;
  iconClass: string;
  activeClass: string;
}[] = [
  {
    mode: 'reply',
    label: 'Direct Reply',
    hint: 'Posts as a comment under the target tweet.',
    Icon: MessageSquare,
    iconClass: 'text-blue-500',
    activeClass:
      'border-indigo-600 bg-indigo-50/60 dark:bg-indigo-950/40 text-indigo-900 dark:text-indigo-100 font-semibold ring-1 ring-indigo-500/30',
  },
  {
    mode: 'quote',
    label: 'Quote Tweet',
    hint: 'Quotes target post on timeline (Supported on all X tiers).',
    Icon: Quote,
    iconClass: 'text-amber-500',
    activeClass:
      'border-amber-600 bg-amber-50/60 dark:bg-amber-950/40 text-amber-900 dark:text-amber-100 font-semibold ring-1 ring-amber-500/30',
  },
  {
    mode: 'standalone',
    label: 'Timeline Drop',
    hint: 'Direct post to timeline without attaching to post.',
    Icon: Globe,
    iconClass: 'text-emerald-500',
    activeClass:
      'border-emerald-600 bg-emerald-50/60 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-100 font-semibold ring-1 ring-emerald-500/30',
  },
];

const SUMMARY: Record<Mode, string> = {
  reply: 'Direct Reply',
  quote: 'Quote Tweet',
  standalone: 'Standalone Post',
};

export const EngagementModeSelector: React.FC<EngagementModeSelectorProps> = ({
  value,
  onChange,
}) => {
  const current: Mode = value || 'reply';
  return (
    <div className="space-y-2 pt-2 border-t border-neutral-100 dark:border-neutral-800">
      <div className="flex items-center justify-between">
        <label className={LABEL_CLASS}>Engagement Mode on X</label>
        <span className="text-[11px] font-mono text-neutral-400">{SUMMARY[current]}</span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {OPTIONS.map(({ mode, label, hint, Icon, iconClass, activeClass }) => (
          <button
            key={mode}
            type="button"
            onClick={() => onChange(mode)}
            className={`p-2.5 ${OPTION_BASE_CLASS} ${current === mode ? activeClass : OPTION_IDLE_CLASS}`}
          >
            <div className="flex items-center gap-1.5 text-xs">
              <Icon className={`w-3.5 h-3.5 ${iconClass}`} />
              <span>{label}</span>
            </div>
            <div className="text-[10px] text-neutral-500 dark:text-neutral-400 font-normal mt-1 leading-snug">
              {hint}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};
