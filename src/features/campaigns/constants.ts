/**
 * X ChromaBot - campaign constants
 * Shared lists and class strings for the campaign feature.
 */

export const TIMEZONES = [
  'America/Denver',
  'America/Los_Angeles',
  'America/New_York',
  'America/Chicago',
  'America/Phoenix',
  'Europe/London',
  'Europe/Paris',
  'Asia/Tokyo',
  'UTC',
];

export const INTERVAL_PRESETS = [
  { label: 'Every 1 minute (Test)', minutes: 1 },
  { label: 'Every 15 minutes', minutes: 15 },
  { label: 'Every 30 minutes', minutes: 30 },
  { label: 'Every 1 hour', minutes: 60 },
  { label: 'Every 3 hours', minutes: 180 },
  { label: 'Every 6 hours', minutes: 360 },
  { label: 'Every 12 hours', minutes: 720 },
  { label: 'Every 24 hours', minutes: 1440 },
];

export const FIELD_CLASS =
  'w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-indigo-500';

export const LABEL_CLASS = 'font-semibold text-neutral-700 dark:text-neutral-300';

export const OPTION_BASE_CLASS =
  'rounded-lg border text-left cursor-pointer transition-all flex flex-col justify-between';

export const OPTION_IDLE_CLASS =
  'border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800/60 text-neutral-700 dark:text-neutral-300 hover:border-neutral-300';
