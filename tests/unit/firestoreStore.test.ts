import { describe, expect, it } from 'vitest';
import {
  FirestoreStore,
  type FirestoreCollectionLike,
  type FirestoreDocRefLike,
  type FirestoreLike,
} from '../../server/store/FirestoreStore.js';
import { createDefaultState } from '../../server/store/defaults.js';
import type { PostLog } from '../../shared/types.js';

type FakeDocRef = FirestoreDocRefLike & { path: string };

/** Minimal in-memory Firestore keyed by document path; rejects `undefined` values like the real one. */
const createFakeFirestore = () => {
  const docs = new Map<string, Record<string, any>>();
  const stats = { deletes: 0, batches: 0 };
  const assertNoUndefined = (v: unknown) => {
    if (v === undefined) throw new Error('Cannot use "undefined" as a Firestore value');
    if (v && typeof v === 'object') Object.values(v).forEach(assertNoUndefined);
  };
  const write = (path: string, data: Record<string, any>) => {
    assertNoUndefined(data);
    docs.set(path, structuredClone(data));
  };
  const docRef = (path: string): FakeDocRef => ({
    path,
    get: async () => ({
      exists: docs.has(path),
      data: () => (docs.has(path) ? structuredClone(docs.get(path)) : undefined),
    }),
    set: async (data) => write(path, data),
    collection: (name) => colRef(`${path}/${name}`),
  });
  const colRef = (path: string): FirestoreCollectionLike => ({
    doc: (id) => docRef(`${path}/${id}`),
    get: async () => ({
      docs: [...docs.keys()]
        .filter((k) => k.startsWith(`${path}/`) && !k.slice(path.length + 1).includes('/'))
        .map((k) => ({ id: k.slice(path.length + 1), data: () => structuredClone(docs.get(k)!) })),
    }),
  });
  const db: FirestoreLike = {
    collection: (name) => colRef(name),
    batch: () => {
      const ops: Array<() => void> = [];
      return {
        set: (ref, data) => ops.push(() => write((ref as FakeDocRef).path, data)),
        delete: (ref) =>
          ops.push(() => {
            stats.deletes += 1;
            docs.delete((ref as FakeDocRef).path);
          }),
        commit: async () => {
          stats.batches += 1;
          ops.forEach((op) => op());
        },
      };
    },
  };
  const logDocCount = () => [...docs.keys()].filter((k) => k.includes('/logs/')).length;
  return { db, docs, stats, logDocCount };
};

const log = (id: string, extra: Partial<PostLog> = {}): PostLog =>
  ({
    id,
    timestamp: '2026-01-01T00:00:00.000Z',
    slotType: 'manual',
    targetTweetId: '1',
    ...extra,
  }) as PostLog;

describe('FirestoreStore', () => {
  it('returns defaults when nothing is stored', async () => {
    const { db } = createFakeFirestore();
    expect(await new FirestoreStore(db).load()).toEqual(createDefaultState());
  });

  it('round-trips state and keeps log order, stripping undefined values', async () => {
    const { db, docs, logDocCount } = createFakeFirestore();
    const state = createDefaultState();
    state.cooldownReason = 'throttled';
    state.logs = [log('b'), log('a', { replyToTweetId: undefined }), log('c/with slash')];
    await new FirestoreStore(db).save(state);

    expect(docs.get('chromabot/state')).not.toHaveProperty('logs');
    expect(logDocCount()).toBe(3);

    const loaded = await new FirestoreStore(db).load();
    expect(loaded.cooldownReason).toBe('throttled');
    expect(loaded.logs.map((l) => l.id)).toEqual(['b', 'a', 'c/with slash']);
  });

  it('writes only new or changed logs and deletes trimmed ones', async () => {
    const { db, docs, stats, logDocCount } = createFakeFirestore();
    const store = new FirestoreStore(db);
    const state = createDefaultState();
    state.logs = [log('a'), log('b'), log('c')];
    await store.save(state);
    expect(logDocCount()).toBe(3);

    state.logs = [log('b'), log('c', { targetTweetId: '2' }), log('d')];
    stats.deletes = 0;
    await store.save(state);
    expect(stats.deletes).toBe(1);
    expect(docs.has('chromabot/state/logs/a')).toBe(false);
    expect(logDocCount()).toBe(3);

    const loaded = await new FirestoreStore(db).load();
    expect(loaded.logs.map((l) => [l.id, l.targetTweetId])).toEqual([
      ['b', '1'],
      ['c', '2'],
      ['d', '1'],
    ]);
  });

  it('splits large log writes into batches of at most 500 operations', async () => {
    const { db, stats, logDocCount } = createFakeFirestore();
    const state = createDefaultState();
    state.logs = Array.from({ length: 1100 }, (_, i) => log(`l${i}`));
    await new FirestoreStore(db).save(state);
    expect(stats.batches).toBe(3);
    expect(logDocCount()).toBe(1100);
  });

  it('does not retain the saved object', async () => {
    const { db } = createFakeFirestore();
    const state = createDefaultState();
    state.logs = [log('a')];
    await new FirestoreStore(db).save(state);
    state.logs[0].targetTweetId = 'mutated';
    expect((await new FirestoreStore(db).load()).logs[0].targetTweetId).toBe('1');
  });
});
