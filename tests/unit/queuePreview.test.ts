import { describe, expect, it } from 'vitest';
import { generateColor } from '../../server/colorEngine.js';
import { formatSlotPreviewText } from '../../server/services/queueSlots.js';
import { AI_TEXT_PLACEHOLDER } from '../../shared/template/agentTags.js';

describe('queue preview text', () => {
  it('shows an AI placeholder, never the color/hex or the raw prompt, for AI-only templates', () => {
    const color = generateColor('evening');
    const text = formatSlotPreviewText(
      '<history><agent>write a long Neruda-like reply about the series</agent></history>',
      color,
      '6:00 PM',
    );
    expect(text).toBe(AI_TEXT_PLACEHOLDER);
    expect(text).not.toContain(color.hex);
    expect(text).not.toContain('Neruda');
  });

  it('keeps the literal text of plain templates intact', () => {
    const text = formatSlotPreviewText(
      'Plain words #love #always',
      generateColor('morning'),
      '6:00 AM',
    );
    expect(text).toBe('Plain words #love #always');
  });
});
