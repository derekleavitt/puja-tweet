/**
 * Gemini configuration: env-driven model list, optional daily call cap, UA string.
 */

export const DEFAULT_GEMINI_MODELS = [
  'gemini-3.8-flash',
  'gemini-3.1-flash-lite',
  'gemini-flash-latest',
];

/** GEMINI_MODEL (primary) then GEMINI_FALLBACK_MODEL (comma list ok); defaults when both unset. */
export function getGeminiModels(env: NodeJS.ProcessEnv = process.env): string[] {
  const split = (v?: string) =>
    (v || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  const configured = [...split(env.GEMINI_MODEL), ...split(env.GEMINI_FALLBACK_MODEL)];
  return Array.from(new Set(configured.length ? configured : DEFAULT_GEMINI_MODELS));
}

export function isGeminiConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!env.GEMINI_API_KEY?.trim();
}

export function getGeminiUserAgent(env: NodeJS.ProcessEnv = process.env): string {
  return `x-chromabot/${env.APP_VERSION || env.npm_package_version || '0.0.0'}`;
}

/** GEMINI_MAX_CALLS_PER_DAY: positive integer, otherwise unlimited (null). */
export function getGeminiDailyCap(env: NodeJS.ProcessEnv = process.env): number | null {
  const n = parseInt(env.GEMINI_MAX_CALLS_PER_DAY || '', 10);
  return n > 0 ? n : null;
}

let counterDay = '';
let counterCalls = 0;

/** Reserve one Gemini call against today's (UTC) cap. Returns false when the cap is reached. */
export function tryConsumeGeminiCall(
  now: Date = new Date(),
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const cap = getGeminiDailyCap(env);
  const day = now.toISOString().slice(0, 10);
  if (day !== counterDay) {
    counterDay = day;
    counterCalls = 0;
  }
  if (cap !== null && counterCalls >= cap) return false;
  counterCalls++;
  return true;
}

export function resetGeminiCallCounter(): void {
  counterDay = '';
  counterCalls = 0;
}
