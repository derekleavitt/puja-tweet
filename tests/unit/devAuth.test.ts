import { describe, it, expect, vi, afterEach } from 'vitest';

async function load(env: { DEV: boolean; VITE_AUTH_DISABLED?: string }) {
  vi.resetModules();
  vi.stubEnv('DEV', env.DEV as unknown as string);
  vi.stubEnv('VITE_AUTH_DISABLED', env.VITE_AUTH_DISABLED ?? '');
  return (await import('../../src/lib/devAuth.js')).DEV_AUTH_BYPASS;
}

describe('DEV_AUTH_BYPASS', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('is on only in dev with VITE_AUTH_DISABLED=true', async () => {
    expect(await load({ DEV: true, VITE_AUTH_DISABLED: 'true' })).toBe(true);
  });

  it('is never on in a production build, even with the flag set', async () => {
    expect(await load({ DEV: false, VITE_AUTH_DISABLED: 'true' })).toBe(false);
  });

  it('is off without the flag', async () => {
    expect(await load({ DEV: true })).toBe(false);
    expect(await load({ DEV: true, VITE_AUTH_DISABLED: 'false' })).toBe(false);
  });
});
