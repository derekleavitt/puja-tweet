import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpError } from '../../server/middleware/error.js';
import { mask } from '../../server/services/credentialService.js';
import { createServices } from '../../server/services/index.js';
import { JsonFileStore } from '../../server/store/JsonFileStore.js';
import { MemoryStore } from '../../server/store/MemoryStore.js';
import { refreshOAuth2Token } from '../../server/twitterClient.js';

const KEY = 'a'.repeat(64);
const ENV_VARS = [
  'TWITTER_API_KEY',
  'TWITTER_API_SECRET',
  'TWITTER_ACCESS_TOKEN',
  'TWITTER_ACCESS_TOKEN_SECRET',
  'TWITTER_OAUTH2_CLIENT_ID',
  'TWITTER_OAUTH2_CLIENT_SECRET',
  'TWITTER_OAUTH2_ACCESS_TOKEN',
  'TWITTER_OAUTH2_REFRESH_TOKEN',
  'TWITTER_BEARER_TOKEN',
];

const OAUTH1 = {
  apiKey: 'consumer-key-1234567890',
  apiSecret: 'consumer-secret-abcdef',
};
const BEARER = { bearerToken: 'app-bearer-token-998877' };
const OAUTH2 = {
  oauth2ClientId: 'client-id-xyz-123456',
  oauth2ClientSecret: 'client-secret-xyz',
  oauth2AccessToken: 'oauth2-access-token-1',
  oauth2RefreshToken: 'oauth2-refresh-token-1',
};

beforeEach(() => {
  for (const v of ENV_VARS) vi.stubEnv(v, '');
  vi.stubEnv('CREDENTIALS_ENCRYPTION_KEY', KEY);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('credentials merge semantics', () => {
  it('saving the bearer token keeps the API key, and blank values keep existing ones', async () => {
    const { credentials } = await createServices(new MemoryStore());
    credentials.updateCredentials(OAUTH1);
    credentials.updateCredentials({ ...BEARER, apiKey: '', apiSecret: undefined });
    expect(credentials.getEffectiveCredentials()).toEqual({ ...OAUTH1, ...BEARER });
    credentials.updateCredentials({ bearerToken: '   ' });
    expect(credentials.getEffectiveCredentials().bearerToken).toBe(BEARER.bearerToken);
  });

  it('ignores user tokens: accounts are connected, not typed in', async () => {
    const { credentials } = await createServices(new MemoryStore());
    credentials.updateCredentials({ ...OAUTH1, accessToken: 'x', oauth2AccessToken: 'y' } as never);
    expect(credentials.getEffectiveCredentials()).toEqual({ ...OAUTH1, bearerToken: '' });
  });

  it('clears one method explicitly and rejects unknown methods', async () => {
    const { credentials } = await createServices(new MemoryStore());
    credentials.updateCredentials({ ...OAUTH1, ...BEARER });
    credentials.clearCredentials('app');
    const eff = credentials.getEffectiveCredentials();
    expect(eff.apiKey).toBe('');
    expect(eff.bearerToken).toBe(BEARER.bearerToken);
    expect(() => credentials.clearCredentials('oauth2')).toThrow(HttpError);
  });

  it('never stores or overrides values provided by env vars', async () => {
    const { credentials } = await createServices(new MemoryStore());
    vi.stubEnv('TWITTER_API_KEY', 'from-env');
    credentials.updateCredentials({ apiKey: 'ui-value', apiSecret: 's3cret-value-ui' });
    expect(credentials.getEffectiveCredentials().apiKey).toBe('from-env');
    vi.stubEnv('TWITTER_API_KEY', '');
    expect(credentials.getEffectiveCredentials().apiKey).toBe('');
    expect(credentials.getEffectiveCredentials().apiSecret).toBe('s3cret-value-ui');
  });

  it('refuses to save UI credentials without an encryption key', async () => {
    vi.stubEnv('CREDENTIALS_ENCRYPTION_KEY', '');
    const { credentials } = await createServices(new MemoryStore());
    expect(() => credentials.updateCredentials(OAUTH1)).toThrow(/CREDENTIALS_ENCRYPTION_KEY/);
    expect(() => credentials.updateCredentials({ apiKey: '' })).not.toThrow();
    expect(credentials.getMaskedCredentialsStatus().canPersistCredentials).toBe(false);
  });
});

describe('credential masking', () => {
  it('shows only bullets and the last 2 characters', async () => {
    expect(mask('abcdefghijklmnop')).toBe('••••op');
    expect(mask('shortkey')).toBe('••••');
    expect(mask('')).toBeNull();
    const { credentials } = await createServices(new MemoryStore());
    credentials.updateCredentials(OAUTH1);
    const json = JSON.stringify(credentials.getMaskedCredentialsStatus());
    expect(json).toContain('••••90');
    expect(credentials.getMaskedCredentialsStatus().isFullyConfigured).toBe(true);
    for (const secret of Object.values(OAUTH1)) expect(json).not.toContain(secret);
  });
});

describe('credentials at rest', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chromabot-cred-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('encrypts on disk and round-trips with the key', async () => {
    const svc = await createServices(new JsonFileStore(dir));
    svc.credentials.updateCredentials({ ...OAUTH1, ...BEARER });
    await svc.flush();
    const raw = fs.readFileSync(path.join(dir, 'bot-store.json'), 'utf8');
    for (const secret of [...Object.values(OAUTH1), ...Object.values(BEARER)]) {
      expect(raw).not.toContain(secret);
    }
    expect(raw).toContain('enc:v1:');

    const reloaded = await createServices(new JsonFileStore(dir));
    expect(reloaded.credentials.getEffectiveCredentials()).toEqual({ ...OAUTH1, ...BEARER });

    vi.stubEnv('CREDENTIALS_ENCRYPTION_KEY', 'b'.repeat(64));
    const wrongKey = await createServices(new JsonFileStore(dir));
    expect(wrongKey.credentials.getEffectiveCredentials().apiKey).toBe('');
  });

  it('drops user tokens an older store kept for the removed default account', async () => {
    const file = path.join(dir, 'bot-store.json');
    const first = await createServices(new JsonFileStore(dir));
    await first.flush();
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    fs.writeFileSync(
      file,
      JSON.stringify({ ...data, credentials: { ...OAUTH1, accessToken: 'old-user-token-123456' } }),
    );
    const svc = await createServices(new JsonFileStore(dir));
    await svc.flush();
    expect(svc.credentials.getEffectiveCredentials()).toMatchObject(OAUTH1);
    expect(fs.readFileSync(file, 'utf8')).not.toContain('old-user-token-123456');
  });

  it('migrates legacy plaintext credentials to the encrypted form', async () => {
    const file = path.join(dir, 'bot-store.json');
    const first = await createServices(new JsonFileStore(dir));
    await first.flush();
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    fs.writeFileSync(file, JSON.stringify({ ...data, credentials: OAUTH1 }));

    const migrated = await createServices(new JsonFileStore(dir));
    await migrated.flush();
    expect(migrated.credentials.getEffectiveCredentials().apiKey).toBe(OAUTH1.apiKey);
    expect(fs.readFileSync(file, 'utf8')).not.toContain(OAUTH1.apiKey);
    const again = await createServices(new JsonFileStore(dir));
    expect(again.credentials.getEffectiveCredentials().apiKey).toBe(OAUTH1.apiKey);
  });
});

describe('OAuth 2.0 refresh (X client only)', () => {
  // Never reaches X: the first tweet call is rejected as expired, the refresh and the retry succeed.
  const mockFetch = () => {
    let tweetCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('oauth2/token')) {
          return new Response(
            JSON.stringify({ access_token: 'new-access-token-2', refresh_token: 'new-refresh-2' }),
            { status: 200 },
          );
        }
        tweetCalls += 1;
        return tweetCalls === 1
          ? new Response('{}', { status: 401 })
          : new Response(JSON.stringify({ data: { id: '42' } }), { status: 201 });
      }),
    );
  };

  it('refreshOAuth2Token hands the rotated pair to the callback', async () => {
    mockFetch();
    const cb = vi.fn();
    await refreshOAuth2Token(OAUTH2, cb);
    expect(cb).toHaveBeenCalledWith({
      accessToken: 'new-access-token-2',
      refreshToken: 'new-refresh-2',
    });
  });
});
