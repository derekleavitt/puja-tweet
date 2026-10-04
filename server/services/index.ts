/**
 * Service composition. `createServices(store)` wires every service over one Store;
 * the `services` singleton picks the store from the `STORE` env var
 * (`json` = default JSON file, `memory` = in-memory, used by the test setup,
 * `firestore` = Firestore through firebase-admin, the production source of truth).
 */

import { getFirestore } from 'firebase-admin/firestore';
import { firestoreConfig } from '../config.js';
import { bindGeminiUsage } from '../geminiConfig.js';
import { getAdminApp } from '../firebaseAdmin.js';
import { FirestoreStore } from '../store/FirestoreStore.js';
import { JsonFileStore } from '../store/JsonFileStore.js';
import { MemoryStore } from '../store/MemoryStore.js';
import type { Store } from '../store/Store.js';
import { ContextService } from './contextService.js';
import { CredentialService } from './credentialService.js';
import { GeminiUsageService } from './geminiUsageService.js';
import { LogService } from './logService.js';
import { QueueService } from './queueService.js';
import { RateLimitService } from './rateLimitService.js';
import { SettingsService } from './settingsService.js';
import { StateManager } from './stateManager.js';

export interface Services {
  contexts: ContextService;
  queue: QueueService;
  logs: LogService;
  settings: SettingsService;
  credentials: CredentialService;
  rateLimit: RateLimitService;
  geminiUsage: GeminiUsageService;
  /** Resolves once every pending write has reached the store. */
  flush(): Promise<void>;
  /** Synchronously writes any unsaved state (shutdown hook only). */
  flushSync(): void;
}

export const createServices = async (store: Store): Promise<Services> => {
  const sm = await StateManager.create(store);
  const queue = new QueueService(sm);
  const contexts = new ContextService(sm, queue);
  const credentials = new CredentialService(sm);

  contexts.ensureDefaultContext();
  credentials.ensureWebhookSecret();
  queue.ensureQueue();

  return {
    contexts,
    queue,
    logs: new LogService(sm, queue),
    settings: new SettingsService(sm, contexts),
    credentials,
    rateLimit: new RateLimitService(sm),
    geminiUsage: new GeminiUsageService(sm),
    flush: () => sm.flush(),
    flushSync: () => sm.flushSync(),
  };
};

export type StoreKind = 'json' | 'memory' | 'firestore';

export const storeKind = (): StoreKind => {
  const raw = (process.env.STORE || 'json').toLowerCase();
  if (raw === 'memory' || raw === 'firestore') return raw;
  if (raw !== 'json') console.warn(`[Store] Unknown STORE="${raw}", using json.`);
  return 'json';
};

const storeFromEnv = (): Store => {
  switch (storeKind()) {
    case 'memory':
      return new MemoryStore();
    case 'firestore':
      console.log(`[Store] Firestore database "${firestoreConfig.databaseId}"`);
      return new FirestoreStore(getFirestore(getAdminApp(), firestoreConfig.databaseId));
    default:
      return new JsonFileStore();
  }
};

export const services: Services = await createServices(storeFromEnv());

// The running app counts Gemini calls in persisted state so restarts don't reset the daily cap.
bindGeminiUsage(services.geminiUsage);
