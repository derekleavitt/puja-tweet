import { describe, expect, it } from 'vitest';
import { classifyXError } from '../../server/xErrors.js';

describe('classifyXError', () => {
  it.each([
    [429, {}, 'rate_limit'],
    [403, { detail: 'Your account is not permitted to access this feature' }, 'cooldown'],
    [403, { detail: 'reply cooldown active' }, 'cooldown'],
    [401, { title: 'Unauthorized' }, 'auth'],
    [402, {}, 'payment'],
    [200, { detail: 'credits depleted' }, 'payment'],
    [404, {}, 'target_missing'],
    [403, { detail: 'Referenced Tweet not found' }, 'target_missing'],
    [403, { detail: 'The post you are replying to was deleted' }, 'target_missing'],
    [403, { detail: 'You can only reply to or quote posts where you are mentioned' }, 'unknown'],
    [
      403,
      { detail: 'You are not allowed to create a Tweet with duplicate content' },
      'text_invalid',
    ],
    [400, { detail: 'Tweet text is too long' }, 'text_invalid'],
    [undefined, undefined, 'network'],
    [500, {}, 'server_error'],
    [503, { title: 'Service Unavailable' }, 'server_error'],
  ])('status %s %j -> %s', (status, body, expected) => {
    expect(classifyXError(status, body)).toBe(expected);
  });
});
