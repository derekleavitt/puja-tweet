import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpError } from '../../server/middleware/error.js';
import { mask } from '../../server/services/credentialService.js';
import { createServices } from '../../server/services/index.js';
import { JsonFileStore } from '../../server/store/JsonFileStore.js';
import { MemoryStore } from '../../server/store/MemoryStore.js';
import { postColorTweet, refreshOAuth2Token } from '../../server/twitterClient.js';

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
  accessToken: 'access-token-0987654321',
  accessTokenSecret: 'access-secret-fedcba',
};
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
  it('saving one auth method keeps the other, and blank values keep existing ones', async () => {
    const { credentials } = await createServices(new MemoryStore());
    credentials.updateCredentials(OAUTH1);
    credentials.updateCredentials({ ...OAUTH2, apiKey: '', accessToken: undefined });
    expect(credentials.getEffectiveCredentials()).toMatchObject({ ...OAUTH1, ...OAUTH2 });

    credentials.updateCredentials({ oauth2AccessToken: '   ' });
    expect(credentials.getEffectiveCredentials().oauth2AccessToken).toBe(OAUTH2.oauth2AccessToken);
  });

  it('clears one method explicitly and rejects unknown methods', async () => {
    const { credentials } = await createServices(new MemoryStore());
    credentials.updateCredentials({ ...OAUTH1, ...OAUTH2 });
    credentials.clearCredentials('oauth1');
    const eff = credentials.getEffectiveCredentials();
    expect(eff.apiKey).toBe('');
    expect(eff.oauth2RefreshToken).toBe(OAUTH2.oauth2RefreshToken);
    expect(() => credentials.clearCredentials('nope')).toThrow(HttpError);
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
    svc.credentials.updateCredentials({ ...OAUTH1, ...OAUTH2 });
    await svc.flush();
    const raw = fs.readFileSync(path.join(dir, 'bot-store.json'), 'utf8');
    for (const secret of [...Object.values(OAUTH1), ...Object.values(OAUTH2)]) {
      expect(raw).not.toContain(secret);
    }
    expect(raw).toContain('enc:v1:');

    const reloaded = await createServices(new JsonFileStore(dir));
    expect(reloaded.credentials.getEffectiveCredentials()).toMatchObject({ ...OAUTH1, ...OAUTH2 });

    vi.stubEnv('CREDENTIALS_ENCRYPTION_KEY', 'b'.repeat(64));
    const wrongKey = await createServices(new JsonFileStore(dir));
    expect(wrongKey.credentials.getEffectiveCredentials().apiKey).toBe('');
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

describe('refreshed OAuth 2.0 tokens', () => {
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

  it('persists tokens refreshed during a post, encrypted, and prefers them over env', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chromabot-refresh-'));
    try {
      const svc = await createServices(new JsonFileStore(dir));
      svc.credentials.updateCredentials(OAUTH2);
      mockFetch();

      const res = await postColorTweet(svc.credentials.getEffectiveCredentials(), {
        text: 'hello',
        engagementMode: 'standalone',
      });
      expect(res.success).toBe(true);

      await svc.flush();
      const raw = fs.readFileSync(path.join(dir, 'bot-store.json'), 'utf8');
      expect(raw).not.toContain('new-refresh-2');

      vi.stubEnv('TWITTER_OAUTH2_REFRESH_TOKEN', 'stale-env-refresh');
      const reloaded = await createServices(new JsonFileStore(dir));
      expect(reloaded.credentials.getEffectiveCredentials()).toMatchObject({
        oauth2AccessToken: 'new-access-token-2',
        oauth2RefreshToken: 'new-refresh-2',
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
