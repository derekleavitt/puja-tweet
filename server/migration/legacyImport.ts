/**
 * Pure mapping + merge logic for the one-time import of the legacy AI Studio Firestore data.
 *
 * The old browser code (src/lib/firestoreSync.ts, deleted in REL-2) wrote, with the client SDK:
 *   contexts/{contextId}          a TweetContext (+ updatedAt, authorEmail)
 *   postLogs/{autoId}             a PostLog (+ syncedAt, authorEmail); the log's own `id` is a field
 *   settings/global_settings      BotSettings (+ updatedAt, updatedBy); may hold a webhookSecret
 * No I/O here: callers pass already-read documents and get back a merged state plus a report.
 */

import { extractTweetId } from '../../shared/tweetId.js';
import { normalizeHHmm, resolveTimezone } from '../../shared/time.js';
import type { ColorData, PostLog, TweetContext } from '../../shared/types.js';
import { maxLogs } from '../services/stateManager.js';
import { createDefaultSettings } from '../store/defaults.js';
import type { BotState } from '../store/Store.js';

export interface LegacyDoc {
  id: string;
  data: Record<string, unknown>;
}

export interface LegacyData {
  contexts: LegacyDoc[];
  postLogs: LegacyDoc[];
  settings: Record<string, unknown> | null;
}

export interface ImportReport {
  contexts: { found: number; added: number; skipped: number };
  logs: { found: number; added: number; skipped: number; trimmed: number };
  settingsFound: boolean;
  warnings: string[];
  notes: string[];
}

type Raw = Record<string, unknown>;

/** Fields that must never be copied from legacy data (credentials, webhook secrets). */
const SECRET_KEY = /secret|token|api[-_]?key|password|credential|bearer|authorization/i;

const ENGAGEMENT = ['reply', 'quote', 'standalone'] as const;
const REPLY_MODES = ['original_post', 'last_comment'] as const;
const THEMES = ['dynamic', 'vibrant', 'minimal', 'poetic'] as const;
const SLOT_TYPES = ['morning', 'evening', 'manual'] as const;
const STATUSES = ['success', 'simulated', 'error'] as const;

const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T | undefined =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;

/** The value as a plain object (arrays excluded), otherwise an empty one. */
const obj = (v: unknown): Raw =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : {};

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

/** ISO string from an ISO string, epoch ms, Date or Firestore Timestamp (or a JSON export of one). */
export const toIso = (v: unknown): string | undefined => {
  let d: Date | undefined;
  if (typeof v === 'string' || typeof v === 'number') d = new Date(v);
  else if (v instanceof Date) d = v;
  else if (v && typeof v === 'object') {
    const o = v as Raw;
    if (typeof o.toDate === 'function') d = o.toDate();
    else if (typeof o._seconds === 'number') d = new Date(o._seconds * 1000);
    else if (typeof o.seconds === 'number') d = new Date(o.seconds * 1000);
  }
  return d && !Number.isNaN(d.getTime()) ? d.toISOString() : undefined;
};

/** Reports secret-looking top-level keys so the owner can see what was deliberately not imported. */
const droppedSecrets = (raw: Raw, label: string, warnings: string[]): void => {
  const keys = Object.keys(raw).filter((k) => SECRET_KEY.test(k));
  if (keys.length) warnings.push(`${label}: dropped secret field(s) ${keys.join(', ')}`);
};

const mapSchedule = (raw: Raw, label: string, warnings: string[]): TweetContext['schedule'] => {
  const d = createDefaultSettings();
  const s = obj(raw.schedule);
  const times: string[] = [];
  for (const t of Array.isArray(s.scheduleTimes) ? s.scheduleTimes : []) {
    const norm = typeof t === 'string' ? normalizeHHmm(t) : null;
    if (norm) times.push(norm);
    else warnings.push(`${label}: dropped unparseable schedule time ${JSON.stringify(t)}`);
  }
  const interval = Number(s.intervalMinutes);
  const jitter = Number(s.jitterPercentage);
  return {
    mode: oneOf(s.mode, ['interval', 'fixed_times'] as const) ?? d.intervalMode ?? 'interval',
    intervalMinutes: Number.isFinite(interval) && interval > 0 ? interval : d.intervalMinutes!,
    scheduleTimes: times.length ? [...new Set(times)] : d.scheduleTimes,
    timezone: resolveTimezone(typeof s.timezone === 'string' ? s.timezone : d.timezone),
    humanizeJitterEnabled:
      typeof s.humanizeJitterEnabled === 'boolean' ? s.humanizeJitterEnabled : true,
    jitterPercentage: Number.isFinite(jitter) && jitter >= 0 ? jitter : d.jitterPercentage!,
  };
};

const mapStats = (raw: Raw): TweetContext['stats'] => {
  if (!raw.stats || typeof raw.stats !== 'object') return undefined;
  const stats = obj(raw.stats);
  const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return {
    totalPosts: n(stats.totalPosts),
    successfulPosts: n(stats.successfulPosts),
    simulatedPosts: n(stats.simulatedPosts),
    failedPosts: n(stats.failedPosts),
  };
};

/**
 * Maps one legacy context doc. Always returns a campaign that is paused (`enabled: false`) and
 * dry-run, whatever its old state, so nothing starts posting live after the import.
 */
export const mapLegacyContext = (
  docId: string,
  raw: Raw,
  warnings: string[],
  now = new Date().toISOString(),
): TweetContext => {
  const id = str(raw.id) ?? docId;
  const label = `context ${id}`;
  droppedSecrets(raw, label, warnings);
  const d = createDefaultSettings();

  const rawTarget = typeof raw.targetTweetId === 'string' ? raw.targetTweetId : '';
  const targetTweetId = rawTarget.trim() ? (extractTweetId(rawTarget) ?? '') : '';
  if (rawTarget.trim() && !targetTweetId) {
    warnings.push(
      `${label}: targetTweetId ${JSON.stringify(rawTarget)} is not a tweet id; cleared`,
    );
  }
  const anchorRaw = typeof raw.lastPostedTweetId === 'string' ? raw.lastPostedTweetId : '';
  const anchor = anchorRaw.trim() ? (extractTweetId(anchorRaw) ?? undefined) : undefined;
  if (anchorRaw.trim() && !anchor) {
    warnings.push(
      `${label}: lastPostedTweetId ${JSON.stringify(anchorRaw)} invalid; anchor dropped`,
    );
  }
  if (raw.enabled === true) warnings.push(`${label}: was enabled, imported PAUSED`);
  if (raw.dryRun !== true) warnings.push(`${label}: was live, imported as DRY-RUN`);

  const ctx: TweetContext = {
    id,
    name: str(raw.name)?.trim() ? (raw.name as string) : id,
    description: str(raw.description),
    targetTweetId,
    replyTargetMode: oneOf(raw.replyTargetMode, REPLY_MODES) ?? 'original_post',
    engagementMode: oneOf(raw.engagementMode, ENGAGEMENT) ?? 'reply',
    autoFallbackToQuote: raw.autoFallbackToQuote === true,
    lastPostedTweetId: anchor,
    enabled: false,
    dryRun: true,
    schedule: mapSchedule(raw, label, warnings),
    template: str(raw.template)?.trim() ? (raw.template as string) : d.template,
    themePreference: oneOf(raw.themePreference, THEMES) ?? 'dynamic',
    lastPostedTimestamp: Number.isFinite(Number(raw.lastPostedTimestamp))
      ? Number(raw.lastPostedTimestamp)
      : undefined,
    lastPostedSlot: str(raw.lastPostedSlot),
    consecutiveErrors: 0,
    stats: mapStats(raw),
    createdAt: toIso(raw.createdAt) ?? now,
    updatedAt: now,
  };
  return JSON.parse(JSON.stringify(ctx));
};

const placeholderColor = (): ColorData => ({
  id: 'legacy',
  name: 'Unknown',
  colorPick: 'Unknown',
  hex: '#808080',
  rgb: { r: 128, g: 128, b: 128 },
  hsl: { h: 0, s: 0, l: 50 },
  cmyk: { c: 0, m: 0, y: 0, k: 50 },
  mood: '',
  weatherDesc: '',
  weatherTweet: '',
  slotType: 'custom',
  companions: [],
  swatchBar: '',
  contrastText: '#FFFFFF',
});

/** Maps one legacy post log, or returns null (with a warning) when it cannot be used. */
export const mapLegacyLog = (docId: string, raw: Raw, warnings: string[]): PostLog | null => {
  const id = str(raw.id) ?? docId;
  const timestamp = toIso(raw.timestamp);
  const status = oneOf(raw.status, STATUSES);
  if (!timestamp || !status) {
    warnings.push(`log ${id}: skipped (missing/invalid ${!timestamp ? 'timestamp' : 'status'})`);
    return null;
  }
  const slotType = oneOf(raw.slotType, SLOT_TYPES);
  if (!slotType)
    warnings.push(`log ${id}: unknown slotType ${JSON.stringify(raw.slotType)}; manual`);
  const color: ColorData =
    raw.color && typeof raw.color === 'object'
      ? { ...placeholderColor(), ...raw.color }
      : placeholderColor();
  const log: PostLog = {
    id,
    timestamp,
    slotType: slotType ?? 'manual',
    scheduledTime: str(raw.scheduledTime),
    targetTweetId: typeof raw.targetTweetId === 'string' ? raw.targetTweetId : '',
    replyToTweetId: str(raw.replyToTweetId),
    quoteTweetId: str(raw.quoteTweetId),
    engagementMode: oneOf(raw.engagementMode, ENGAGEMENT),
    color,
    tweetText: typeof raw.tweetText === 'string' ? raw.tweetText : '',
    tweetId: str(raw.tweetId),
    tweetUrl: str(raw.tweetUrl),
    status,
    errorMessage: str(raw.errorMessage),
    contextId: str(raw.contextId),
    contextName: str(raw.contextName),
    fallbackTriggered:
      typeof raw.fallbackTriggered === 'boolean' ? raw.fallbackTriggered : undefined,
  };
  return JSON.parse(JSON.stringify(log));
};

/** Builds a paused dry-run primary campaign from the legacy global settings (pre-multi-context data). */
const contextFromSettings = (s: Raw, warnings: string[], now: string): TweetContext =>
  mapLegacyContext(
    'ctx_primary',
    {
      name: 'Primary Eternal Colors',
      description: 'Imported from legacy global settings',
      targetTweetId: s.targetTweetId,
      replyTargetMode: s.replyTargetMode,
      engagementMode: s.engagementMode,
      autoFallbackToQuote: s.autoFallbackToQuote,
      lastPostedTweetId: s.lastPostedTweetId,
      enabled: s.schedulerEnabled,
      dryRun: s.dryRun,
      template: s.template,
      themePreference: s.themePreference,
      schedule: {
        mode: s.intervalMode,
        intervalMinutes: s.intervalMinutes,
        scheduleTimes: s.scheduleTimes,
        timezone: s.timezone,
        humanizeJitterEnabled: s.humanizeJitterEnabled,
        jitterPercentage: s.jitterPercentage,
      },
    },
    warnings,
    now,
  );

const mergeContexts = (
  next: BotState,
  legacy: LegacyData,
  report: ImportReport,
  now: string,
): void => {
  const settings = legacy.settings;
  const candidates: Array<{ id: string; data: Raw; fromSettings?: boolean }> = legacy.contexts.map(
    (c) => ({ id: str(c.data.id) ?? c.id, data: c.data }),
  );
  if (settings && settings.targetTweetId && !candidates.some((c) => c.id === 'ctx_primary')) {
    candidates.push({ id: 'ctx_primary', data: {}, fromSettings: true });
    report.notes.push('No legacy ctx_primary document: building it from settings/global_settings.');
  }
  const ids = new Set(next.contexts.map((c) => c.id));
  report.contexts.found = candidates.length;
  for (const c of candidates) {
    if (ids.has(c.id)) {
      report.contexts.skipped++;
      continue;
    }
    next.contexts.push(
      c.fromSettings && settings
        ? contextFromSettings(settings, report.warnings, now)
        : mapLegacyContext(c.id, c.data, report.warnings, now),
    );
    ids.add(c.id);
    report.contexts.added++;
  }
  if (report.contexts.added) {
    report.notes.push(`${report.contexts.added} imported campaign(s) set to paused + dry-run.`);
  }
};

const mergeLogs = (next: BotState, legacy: LegacyData, report: ImportReport): void => {
  const ids = new Set(next.logs.map((l) => l.id));
  report.logs.found = legacy.postLogs.length;
  for (const doc of legacy.postLogs) {
    const log = mapLegacyLog(doc.id, doc.data, report.warnings);
    if (!log || ids.has(log.id)) {
      report.logs.skipped++;
      continue;
    }
    next.logs.push(log);
    ids.add(log.id);
    report.logs.added++;
  }
  if (!report.logs.added) return;
  next.logs.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const cap = maxLogs();
  if (next.logs.length > cap) {
    report.logs.trimmed = next.logs.length - cap;
    next.logs.splice(0, report.logs.trimmed);
    report.warnings.push(`${report.logs.trimmed} oldest log(s) trimmed to MAX_LOGS (${cap})`);
  }
};

/**
 * Merges legacy data into `state` (returns a new state; the input is not mutated). Imported
 * contexts and logs are added only when their id is not already present, so re-running is a no-op.
 * Existing settings (including the globalDryRun / globalPaused master switches) are never changed,
 * except filling an empty settings.targetTweetId from the legacy settings.
 */
export const mergeLegacyData = (
  state: BotState,
  legacy: LegacyData,
  now = new Date().toISOString(),
): { state: BotState; report: ImportReport } => {
  const next: BotState = {
    ...state,
    settings: { ...state.settings },
    contexts: [...state.contexts],
    logs: [...state.logs],
  };
  const report: ImportReport = {
    contexts: { found: 0, added: 0, skipped: 0 },
    logs: { found: 0, added: 0, skipped: 0, trimmed: 0 },
    settingsFound: !!legacy.settings,
    warnings: [],
    notes: [],
  };
  if (legacy.settings) droppedSecrets(legacy.settings, 'settings', report.warnings);
  mergeContexts(next, legacy, report, now);
  const target = legacy.settings?.targetTweetId;
  if (!next.settings.targetTweetId && typeof target === 'string') {
    next.settings.targetTweetId = extractTweetId(target) ?? '';
  }
  mergeLogs(next, legacy, report);
  return { state: next, report };
};

export const formatReport = (r: ImportReport, apply: boolean): string => {
  const rows = [
    ['', 'found', 'new', 'skipped'],
    ['contexts', r.contexts.found, r.contexts.added, r.contexts.skipped],
    ['logs', r.logs.found, r.logs.added, r.logs.skipped],
  ].map((row) => row.map(String));
  const out = rows.map(
    (row) =>
      `${row[0].padEnd(10)}${row
        .slice(1)
        .map((c) => c.padStart(8))
        .join('')}`,
  );
  out.push(`settings   ${r.settingsFound ? 'found (non-secret fields only)' : 'not found'}`);
  for (const n of r.notes) out.push(`note: ${n}`);
  for (const w of r.warnings) out.push(`warning: ${w}`);
  out.push(apply ? 'APPLIED.' : 'DRY RUN: nothing written. Re-run with --apply to write.');
  return out.join('\n');
};
