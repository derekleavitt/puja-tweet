/**
 * Service composition. `createServices(store)` wires every service over one Store;
 * the `services` singleton picks the store from the `STORE` env var
 * (`json` = default JSON file, `memory` = in-memory, used by the test setup).
 */

import { JsonFileStore } from '../store/JsonFileStore.js';
import { MemoryStore } from '../store/MemoryStore.js';
import type { Store } from '../store/Store.js';
import { ContextService } from './contextService.js';
import { CredentialService } from './credentialService.js';
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
    flush: () => sm.flush(),
    flushSync: () => sm.flushSync(),
  };
};

const storeFromEnv = (): Store =>
  process.env.STORE === 'memory' ? new MemoryStore() : new JsonFileStore();

export const services: Services = await createServices(storeFromEnv());
