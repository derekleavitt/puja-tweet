import { describe, expect, it } from 'vitest';
import { normaliseSecretEnv } from '../../server/config.js';

describe('normaliseSecretEnv', () => {
  it('strips trailing newlines and spaces from secret env vars', () => {
    const env: NodeJS.ProcessEnv = {
      CRON_SECRET: 'abc123\n',
      WEBHOOK_SECRET: '  hook \r\n',
      TWITTER_API_KEY: 'key\n',
      UNRELATED: 'keep me\n',
    };
    normaliseSecretEnv(env);
    expect(env.CRON_SECRET).toBe('abc123');
    expect(env.WEBHOOK_SECRET).toBe('hook');
    expect(env.TWITTER_API_KEY).toBe('key');
    expect(env.UNRELATED).toBe('keep me\n');
  });
});
