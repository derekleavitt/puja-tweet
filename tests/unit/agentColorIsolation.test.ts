import { afterEach, describe, expect, it, vi } from 'vitest';
import { trimToCompleteSentence } from '../../shared/tweetLength.js';
import {
  AgentUnavailableError,
  formatHistoryForPrompt,
  resolveTemplateText,
  stripColorHeader,
} from '../../server/templateAgent.js';
import { generateColor } from '../../server/colorEngine.js';
import type { PostLog } from '../../shared/types.js';

afterEach(() => vi.unstubAllEnvs());

describe('AI-only templates never carry color', () => {
  it('strips an echoed "Name (#HEX) —" header', () => {
    expect(stripColorHeader('Sunset Copper (#C03F0B) — The coastal fog softens.')).toBe(
      'The coastal fog softens.',
    );
    expect(stripColorHeader('No header here.')).toBe('No header here.');
  });

  it('formats history without color labels when the template has no color tokens', () => {
    const history = [
      {
        timestamp: '2026-10-04T00:00:00Z',
        slotType: 'manual',
        tweetText: 'hello',
        color: { name: 'Copper', hex: '#C03F0B' },
      },
    ] as unknown as PostLog[];
    expect(formatHistoryForPrompt(history, false)).not.toMatch(/#C03F0B|Copper/);
    expect(formatHistoryForPrompt(history, true)).toMatch(/#C03F0B/);
  });

  it('fails visibly instead of posting color filler when AI is unavailable', async () => {
    vi.stubEnv('GEMINI_API_KEY', '');
    await expect(
      resolveTemplateText('<agent>write a love note</agent>', generateColor('evening')),
    ).rejects.toBeInstanceOf(AgentUnavailableError);
  });

  it('keeps the color fallback for color templates', async () => {
    vi.stubEnv('GEMINI_API_KEY', '');
    const color = generateColor('evening');
    const text = await resolveTemplateText('{color_pick} <agent>poem</agent>', color);
    expect(text).toContain(color.hex);
  });
});

describe('trimToCompleteSentence', () => {
  it('ends on a full sentence instead of cutting mid-thought', () => {
    const text =
      'The coastal fog softens the edges of the world. The tide reveals the metal beneath, and kindness is not fragility but the fire that keeps a heart warm through every long and patient night by the sea.';
    const out = trimToCompleteSentence(text, 120);
    expect(out).toBe('The coastal fog softens the edges of the world.');
  });

  it('leaves short text alone', () => {
    expect(trimToCompleteSentence('Short.', 240)).toBe('Short.');
  });
});
