import { afterEach, describe, expect, it } from 'vitest';
import {
  bindGeminiUsage,
  resetGeminiCallCounter,
  tryConsumeGeminiCall,
} from '../../server/geminiConfig.js';
import { createServices } from '../../server/services/index.js';
import { MemoryStore } from '../../server/store/MemoryStore.js';

const env = { GEMINI_MAX_CALLS_PER_DAY: '2' };
const day = new Date('2026-03-01T10:00:00Z');

afterEach(() => resetGeminiCallCounter());

describe('Gemini daily cap persistence', () => {
  it('survives a restart (same store, fresh services)', async () => {
    const store = new MemoryStore();
    const first = await createServices(store);
    bindGeminiUsage(first.geminiUsage);
    expect(tryConsumeGeminiCall(day, env)).toBe(true);
    expect(tryConsumeGeminiCall(day, env)).toBe(true);
    await first.flush();
    expect(store.snapshot()?.geminiUsage).toEqual({ day: '2026-03-01', calls: 2 });

    const second = await createServices(store);
    bindGeminiUsage(second.geminiUsage);
    expect(tryConsumeGeminiCall(day, env)).toBe(false);
    expect(tryConsumeGeminiCall(new Date('2026-03-02T00:00:01Z'), env)).toBe(true);
  });
});
