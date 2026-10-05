/**
 * Gemini configuration: env-driven model list, optional daily call cap, UA string.
 */

/** Owner's choice: Flash-Lite only (GEMINI_MODEL / GEMINI_FALLBACK_MODEL override it). */
export const DEFAULT_GEMINI_MODELS = ['gemini-3.1-flash-lite'];

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

/** Per-day (UTC) Gemini call count. */
export interface GeminiUsage {
  day: string;
  calls: number;
}

/** Where the counter lives; the services layer binds one backed by persisted bot state. */
export interface GeminiUsageStore {
  get(): GeminiUsage;
  set(usage: GeminiUsage): void;
}

const memoryUsage = (): GeminiUsageStore => {
  let usage: GeminiUsage = { day: '', calls: 0 };
  return { get: () => usage, set: (u) => (usage = u) };
};

let usageStore: GeminiUsageStore = memoryUsage();

/** Routes the daily counter through `store` (persisted across restarts). */
export function bindGeminiUsage(store: GeminiUsageStore): void {
  usageStore = store;
}

/** Reserve one Gemini call against today's (UTC) cap. Returns false when the cap is reached. */
export function tryConsumeGeminiCall(
  now: Date = new Date(),
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const cap = getGeminiDailyCap(env);
  const day = now.toISOString().slice(0, 10);
  let { calls } = usageStore.get();
  if (usageStore.get().day !== day) calls = 0;
  if (cap !== null && calls >= cap) {
    usageStore.set({ day, calls });
    return false;
  }
  usageStore.set({ day, calls: calls + 1 });
  return true;
}

export function resetGeminiCallCounter(): void {
  usageStore.set({ day: '', calls: 0 });
}
