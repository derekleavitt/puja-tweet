import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateColor } from '../../server/colorEngine.js';
import {
  checkTweetText,
  truncateAtWordBoundary,
  weightedTweetLength,
} from '../../shared/tweetLength.js';
import {
  getGeminiModels,
  resetGeminiCallCounter,
  tryConsumeGeminiCall,
} from '../../server/geminiConfig.js';

const generateContent = vi.fn();
let logs: any[] = [];

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent: (...a: unknown[]) => generateContent(...a) };
  },
}));
vi.mock('../../server/services/index.js', () => ({
  services: { logs: { getLogs: () => logs } },
}));

const { resolveTemplateText, getSeriesHistory, generatePoeticAgentText } =
  await import('../../server/templateAgent.js');

describe('weightedTweetLength', () => {
  it('counts plain chars, emoji as 2 and URLs as 23', () => {
    expect(weightedTweetLength('hello')).toBe(5);
    expect(weightedTweetLength('a😀')).toBe(3);
    expect(weightedTweetLength('see https://example.com/a/very/long/path?x=1')).toBe(4 + 23);
  });

  it('checkTweetText rejects empty and > 280', () => {
    expect(checkTweetText('ok').ok).toBe(true);
    expect(checkTweetText('  ').ok).toBe(false);
    expect(checkTweetText('x'.repeat(281))).toMatchObject({ ok: false, error: 'text_invalid' });
    expect(checkTweetText('😀'.repeat(141)).ok).toBe(false);
    expect(checkTweetText('😀'.repeat(140)).ok).toBe(true);
  });

  it('truncates at a word boundary within the limit', () => {
    const out = truncateAtWordBoundary('alpha beta gamma delta epsilon', 16);
    expect(weightedTweetLength(out)).toBeLessThanOrEqual(16);
    expect(out).toBe('alpha beta…');
  });
});

describe('gemini config', () => {
  it('defaults and env overrides for models', () => {
    expect(getGeminiModels({})).toEqual(['gemini-3.1-flash-lite']);
    expect(getGeminiModels({ GEMINI_MODEL: 'a', GEMINI_FALLBACK_MODEL: 'b, c' })).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('daily cap is unlimited when unset and enforced when set', () => {
    resetGeminiCallCounter();
    for (let i = 0; i < 5; i++) expect(tryConsumeGeminiCall(new Date(), {})).toBe(true);
    resetGeminiCallCounter();
    const env = { GEMINI_MAX_CALLS_PER_DAY: '2' };
    const day = new Date('2026-01-01T12:00:00Z');
    expect(tryConsumeGeminiCall(day, env)).toBe(true);
    expect(tryConsumeGeminiCall(day, env)).toBe(true);
    expect(tryConsumeGeminiCall(day, env)).toBe(false);
    expect(tryConsumeGeminiCall(new Date('2026-01-02T00:00:01Z'), env)).toBe(true);
    resetGeminiCallCounter();
  });
});

describe('template agent', () => {
  const color = generateColor('morning');
  const prevKey = process.env.GEMINI_API_KEY;

  beforeEach(() => {
    generateContent.mockReset();
    logs = [];
    process.env.GEMINI_API_KEY = 'test-key';
    delete process.env.GEMINI_MODEL;
    delete process.env.GEMINI_FALLBACK_MODEL;
    delete process.env.GEMINI_MAX_CALLS_PER_DAY;
    resetGeminiCallCounter();
  });
  afterEach(() => {
    if (prevKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prevKey;
  });

  it('inserts generated text literally (no $& expansion)', async () => {
    generateContent.mockResolvedValue({ text: 'cost $& and $1 and $$' });
    const out = await resolveTemplateText('A <agent>go</agent> B', color);
    expect(out).toBe('A cost $& and $1 and $$ B');
  });

  it('without a key resolves to the fallback without calling Gemini', async () => {
    delete process.env.GEMINI_API_KEY;
    const out = await generatePoeticAgentText('go', color, null);
    expect(out).toContain(color.hex);
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('uses configured models', async () => {
    process.env.GEMINI_MODEL = 'custom-model';
    generateContent.mockResolvedValue({ text: 'hi' });
    await generatePoeticAgentText('go', color, null);
    expect(generateContent.mock.calls[0][0].model).toBe('custom-model');
  });

  it('regenerates once when too long, then truncates', async () => {
    generateContent.mockResolvedValue({ text: 'word '.repeat(80) });
    const out = await generatePoeticAgentText('go', color, null);
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(weightedTweetLength(out)).toBeLessThanOrEqual(240);
  });

  it('stops calling Gemini once the daily cap is hit', async () => {
    process.env.GEMINI_MAX_CALLS_PER_DAY = '1';
    generateContent.mockResolvedValue({ text: 'hi' });
    await generatePoeticAgentText('go', color, null);
    const out = await generatePoeticAgentText('go', color, null);
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(out).toContain(color.hex);
  });

  it('history: same-context success logs only, no cross-context fallback', () => {
    const mk = (id: string, contextId: string, status: string) => ({
      id,
      contextId,
      status,
      targetTweetId: 't',
      tweetText: id,
    });
    logs = [
      mk('c', 'A', 'success'),
      mk('b', 'B', 'success'),
      mk('x', 'A', 'error'),
      mk('a', 'A', 'success'),
    ];
    expect(getSeriesHistory('A').map((l) => l.id)).toEqual(['a', 'c']);
    expect(getSeriesHistory('Z')).toEqual([]);
    expect(getSeriesHistory()).toEqual([]);
  });
});
