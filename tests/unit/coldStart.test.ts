import { describe, expect, it } from 'vitest';
import { createServices } from '../../server/services/index.js';
import {
  FirestoreStore,
  type FirestoreDocRefLike,
  type FirestoreLike,
} from '../../server/store/FirestoreStore.js';
import { createDefaultState } from '../../server/store/defaults.js';

/** Fake Firestore whose state document answers after a delay (a cold network round trip). */
const slowFirestore = (stored: Record<string, unknown>, delayMs: number) => {
  let served = false;
  const doc = (id: string): FirestoreDocRefLike => ({
    get: async () => {
      await new Promise((r) => setTimeout(r, delayMs));
      served = true;
      return { exists: id === 'state', data: () => (id === 'state' ? stored : undefined) };
    },
    set: async () => {},
    collection: () => ({ doc, get: async () => ({ docs: [] }) }),
  });
  const db: FirestoreLike = {
    collection: () => ({ doc, get: async () => ({ docs: [] }) }),
    batch: () => ({ set: () => {}, delete: () => {}, commit: async () => {} }),
  };
  return { db, wasServed: () => served };
};

describe('cold start', () => {
  it('createServices resolves only after the Firestore state has been loaded', async () => {
    const base = createDefaultState();
    const contexts = [{ ...base.contexts[0], id: 'ctx_persisted', name: 'Persisted campaign' }];
    const { db, wasServed } = slowFirestore(
      { ...base, contexts, activeContextId: 'ctx_persisted' },
      30,
    );
    const services = await createServices(new FirestoreStore(db));
    expect(wasServed()).toBe(true);
    expect(services.contexts.getContext('ctx_persisted')?.name).toBe('Persisted campaign');
  });
});
