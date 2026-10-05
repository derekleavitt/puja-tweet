/**
 * X ChromaBot - template presets
 * The single list of AI poetry presets and agent-tag snippets used by TemplateEditor.
 */

export const DEFAULT_TEMPLATE = '{color_pick} {weather_desc} #eternal #colors';

export const TEMPLATE_PRESETS = [
  {
    label: '📜 Neruda Arc with History',
    template:
      '<history><agent>consider what has already been said and respond with just the body of a tweet that is unique pablo neruda like expression that plays on the series thats been written thus far</agent></history>',
    className:
      'bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/40 dark:hover:bg-amber-950/70 text-amber-800 dark:text-amber-200 border-amber-300 dark:border-amber-800',
  },
  {
    label: '✍️ Neruda Solo Poem',
    template:
      '<agent>respond with just the body of a tweet that is unique pablo neruda like expression</agent>',
    className:
      'bg-purple-50 hover:bg-purple-100 dark:bg-purple-950/40 dark:hover:bg-purple-950/70 text-purple-800 dark:text-purple-200 border-purple-300 dark:border-purple-800',
  },
  {
    label: '✨ Swatch + History Arc',
    template:
      '{color_pick} {hex} | <history><agent>Write a visceral 2-line Neruda-style poem connecting this new hue to previous drops</agent></history> #eternal #colors',
    className:
      'bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/40 dark:hover:bg-indigo-950/70 text-indigo-800 dark:text-indigo-200 border-indigo-300 dark:border-indigo-800',
  },
];

export const AGENT_SNIPPETS = [
  {
    label: '+ <agent>...</agent>',
    snippet: '<agent>Write a short poetic expression</agent>',
    className:
      'bg-purple-50 hover:bg-purple-100 dark:bg-purple-950/60 dark:hover:bg-purple-900 text-purple-700 dark:text-purple-300 border-purple-300 dark:border-purple-800',
  },
  {
    label: '+ <history><agent>...</agent></history>',
    snippet: '<history><agent>Consider prior tweets and write a short poem</agent></history>',
    className:
      'bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/60 dark:hover:bg-amber-900 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-800',
  },
];
