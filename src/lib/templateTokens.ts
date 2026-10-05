/**
 * X ChromaBot - template token helpers (UI only)
 * Decides whether color controls are worth showing for a template. Pure; never changes what posts.
 */

import { TEMPLATE_TOKENS } from '../../shared/template/substitute.js';

/** Tokens substituteTemplate() fills from the generated color ({time_tag}/{time_slot} do not). */
export const COLOR_TOKENS: readonly string[] = [
  ...TEMPLATE_TOKENS.filter((token) => token !== '{time_tag}'),
  '{weather_description}',
  '{companions}',
];

/** True when the template's text depends on the drop color. */
export function templateUsesColor(template: string | undefined | null): boolean {
  if (!template) return false;
  return COLOR_TOKENS.some((token) => template.includes(token));
}
