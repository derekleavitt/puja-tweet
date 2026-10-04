import { describe, it, expect } from 'vitest';
import { shouldPoll } from '../../src/hooks/usePolling';

describe('shouldPoll', () => {
  it('polls when enabled and visible', () => {
    expect(shouldPoll(true, 'visible')).toBe(true);
  });
  it('pauses when the tab is hidden', () => {
    expect(shouldPoll(true, 'hidden')).toBe(false);
  });
  it('does not poll when disabled', () => {
    expect(shouldPoll(false, 'visible')).toBe(false);
  });
});
