/**
 * Firestore persistence (STORE=firestore), the production source of truth.
 *
 * Layout (all server-side via firebase-admin; client access is denied by firestore.rules):
 *   chromabot/state            everything except the logs, plus `logOrder` (ids, oldest first)
 *   chromabot/state/logs/{id}  one document per PostLog: `{ id, log }`
 * Per-log documents keep the state document far below the 1 MiB limit (logs are capped by MAX_LOGS)
 * and let a save write only the logs that are new or changed and delete the ones that were trimmed.
 */

import type { PostLog } from '../../shared/types.js';
import { createDefaultState, normalizeState } from './defaults.js';
import type { BotState, Store } from './Store.js';

/** The slice of the Firestore API used here (satisfied by firebase-admin's Firestore and by test fakes). */
export interface FirestoreDocSnapshotLike {
  exists: boolean;
  data(): Record<string, unknown> | undefined;
}
export interface FirestoreDocRefLike {
  get(): Promise<FirestoreDocSnapshotLike>;
  set(data: Record<string, unknown>): Promise<unknown>;
  collection(name: string): FirestoreCollectionLike;
}
export interface FirestoreCollectionLike {
  doc(id: string): FirestoreDocRefLike;
  get(): Promise<{ docs: Array<{ id: string; data(): Record<string, unknown> }> }>;
}
export interface FirestoreWriteBatchLike {
  set(ref: FirestoreDocRefLike, data: Record<string, unknown>): unknown;
  delete(ref: FirestoreDocRefLike): unknown;
  commit(): Promise<unknown>;
}
export interface FirestoreLike {
  collection(name: string): FirestoreCollectionLike;
  batch(): FirestoreWriteBatchLike;
}

/** Firestore allows 500 writes per batch. */
const BATCH_LIMIT = 500;

/** Strips `undefined` (rejected by Firestore) and detaches from the caller's object. */
const clean = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const logDocId = (id: string): string => encodeURIComponent(id);

export class FirestoreStore implements Store {
  private readonly db: FirestoreLike;
  private readonly stateDoc: FirestoreDocRefLike;
  private readonly logsCol: FirestoreCollectionLike;
  /** Serialized form of each log as last known to Firestore, keyed by log id. */
  private known = new Map<string, string>();

  constructor(db: FirestoreLike, root = 'chromabot') {
    this.db = db;
    this.stateDoc = db.collection(root).doc('state');
    this.logsCol = this.stateDoc.collection('logs');
  }

  async load(): Promise<BotState> {
    const snap = await this.stateDoc.get();
    if (!snap.exists) {
      this.known = new Map();
      return createDefaultState();
    }
    const { logOrder, ...rest } = (snap.data() ?? {}) as Record<string, unknown>;
    const byId = new Map<string, PostLog>();
    const logSnap = await this.logsCol.get();
    for (const d of logSnap.docs) {
      const { id, log } = d.data() as { id: string; log: PostLog };
      if (log) byId.set(id ?? log.id, log);
    }
    const order: string[] = Array.isArray(logOrder) ? logOrder : [];
    const logs = order.map((id) => byId.get(id)).filter((l): l is PostLog => !!l);
    this.known = new Map(logs.map((l) => [l.id, JSON.stringify(l)]));
    return normalizeState({ ...rest, logs });
  }

  async save(state: BotState): Promise<void> {
    const { logs: rawLogs, ...rest } = clean(state);
    // De-duplicate by id (last wins) so order and documents stay consistent.
    const logMap = new Map<string, PostLog>();
    for (const log of rawLogs) logMap.set(log.id, log);
    const logs = [...logMap.values()];

    const writes: Array<(b: FirestoreWriteBatchLike) => void> = [];
    const next = new Map<string, string>();
    for (const log of logs) {
      const json = JSON.stringify(log);
      next.set(log.id, json);
      if (this.known.get(log.id) !== json) {
        writes.push((b) => b.set(this.logsCol.doc(logDocId(log.id)), { id: log.id, log }));
      }
    }
    for (const id of this.known.keys()) {
      if (!next.has(id)) writes.push((b) => b.delete(this.logsCol.doc(logDocId(id))));
    }

    // Log documents first, state document last: it is the index, so a partial failure never
    // points at logs that were not written (and the next save retries the remainder).
    for (let i = 0; i < writes.length; i += BATCH_LIMIT) {
      const batch = this.db.batch();
      for (const w of writes.slice(i, i + BATCH_LIMIT)) w(batch);
      await batch.commit();
    }
    await this.stateDoc.set({
      ...rest,
      logOrder: logs.map((l) => l.id),
      updatedAt: new Date().toISOString(),
    });
    this.known = next;
  }
}
