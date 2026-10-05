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

describe('conversation queue slots', () => {
  it('shows the AI placeholder, the next speaker on slot 1 only, and no color text', async () => {
    const { createQueueSlotForContext } = await import('../../server/services/queueSlots.js');
    const ctx = {
      id: 'ctx_c',
      name: 'Chat',
      targetTweetId: '1',
      template: 'secret {color_pick}',
      schedule: { mode: 'interval', intervalMinutes: 15 },
      mode: 'conversation',
      conversationState: { runId: 'run_1', turnCount: 0, nextSpeakerAccountId: 'acct_1' },
    } as unknown as Parameters<typeof createQueueSlotForContext>[0];
    const first = createQueueSlotForContext(ctx, 0);
    const later = createQueueSlotForContext(ctx, 1);
    expect(first.speakerAccountId).toBe('acct_1');
    expect(later.speakerAccountId).toBeUndefined();
    for (const slot of [first, later]) {
      expect(slot.previewText).toBe('✨ AI turn, written when it posts');
    }
  });
});
