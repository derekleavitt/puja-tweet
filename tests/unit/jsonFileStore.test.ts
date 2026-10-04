import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServices } from '../../server/services/index.js';
import { StateManager, maxLogs } from '../../server/services/stateManager.js';
import { JsonFileStore } from '../../server/store/JsonFileStore.js';
import { MemoryStore } from '../../server/store/MemoryStore.js';
import { createDefaultState } from '../../server/store/defaults.js';
import type { PostLog } from '../../shared/types.js';

describe('JsonFileStore', () => {
  let dir: string;
  const file = () => path.join(dir, 'bot-store.json');

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chromabot-store-'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('writes atomically via a temp file and keeps a .bak of the previous version', async () => {
    const store = new JsonFileStore(dir);
    const renameSpy = vi.spyOn(fs.promises, 'rename');
    const a = createDefaultState();
    a.cooldownReason = 'first';
    await store.save(a);
    a.cooldownReason = 'second';
    await store.save(a);
    expect(renameSpy).toHaveBeenCalledWith(`${file()}.tmp`, file());
    expect(fs.existsSync(`${file()}.tmp`)).toBe(false);
    expect(JSON.parse(fs.readFileSync(file(), 'utf-8')).cooldownReason).toBe('second');
    expect(JSON.parse(fs.readFileSync(`${file()}.bak`, 'utf-8')).cooldownReason).toBe('first');
  });

  it('saveSync is atomic too', () => {
    const store = new JsonFileStore(dir);
    store.saveSync(createDefaultState());
    store.saveSync(createDefaultState());
    expect(fs.existsSync(`${file()}.tmp`)).toBe(false);
    expect(fs.existsSync(`${file()}.bak`)).toBe(true);
  });

  it('recovers from the backup when the main file is corrupt', async () => {
    const store = new JsonFileStore(dir);
    const s = createDefaultState();
    s.cooldownReason = 'good';
    await store.save(s);
    await store.save(s);
    fs.writeFileSync(file(), '{ not json');
    expect((await store.load()).cooldownReason).toBe('good');
  });

  it('refuses to boot when file and backup are unreadable unless ALLOW_FRESH_STORE', async () => {
    fs.writeFileSync(file(), '{ not json');
    await expect(new JsonFileStore(dir).load()).rejects.toThrow(/ALLOW_FRESH_STORE/);
    const fresh = await new JsonFileStore(dir, { allowFreshStore: true }).load();
    expect(fresh.logs).toEqual([]);
  });

  it('returns defaults when nothing is stored', async () => {
    expect((await new JsonFileStore(dir).load()).logs).toEqual([]);
  });
});

describe('StateManager persistence', () => {
  afterEach(() => vi.useRealTimers());

  it('debounces bursts of persist() into one write', async () => {
    vi.useFakeTimers();
    const store = new MemoryStore();
    const sm = await StateManager.create(store);
    for (let i = 0; i < 20; i++) sm.persist();
    expect(store.saveCount).toBe(0);
    await vi.advanceTimersByTimeAsync(300);
    await sm.flush();
    expect(store.saveCount).toBe(1);
  });

  it('flushSync writes pending state synchronously', async () => {
    const saveSync = vi.fn();
    const store = Object.assign(new MemoryStore(), { saveSync });
    const sm = await StateManager.create(store);
    sm.persist();
    sm.flushSync();
    expect(saveSync).toHaveBeenCalledTimes(1);
    sm.flushSync();
    expect(saveSync).toHaveBeenCalledTimes(1);
  });
});

describe('read-only GET paths and log cap', () => {
  it('getQueue does not persist or mutate state', async () => {
    const store = new MemoryStore();
    const svc = await createServices(store);
    await svc.flush();
    const saves = store.saveCount;
    const before = JSON.stringify(svc.queue.getQueue());
    svc.queue.getQueue();
    svc.queue.getQueue('ctx_primary');
    await svc.flush();
    expect(store.saveCount).toBe(saves);
    expect(JSON.stringify(svc.queue.getQueue())).toBe(before);
  });

  it('caps in-memory logs at MAX_LOGS, trimming the oldest', async () => {
    vi.stubEnv('MAX_LOGS', '5');
    try {
      expect(maxLogs()).toBe(5);
      const svc = await createServices(new MemoryStore());
      for (let i = 0; i < 12; i++) svc.logs.addLog({ id: `l${i}`, status: 'success' } as PostLog);
      const logs = svc.logs.getLogs();
      expect(logs).toHaveLength(5);
      expect(logs[0].id).toBe('l11');
      expect(logs[4].id).toBe('l7');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('defaults MAX_LOGS to 500', () => {
    vi.stubEnv('MAX_LOGS', '');
    expect(maxLogs()).toBe(500);
    vi.unstubAllEnvs();
  });
});
