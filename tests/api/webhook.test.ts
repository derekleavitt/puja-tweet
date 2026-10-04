import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { postColorTweet } from '../../server/twitterClient.js';
import { makeApp, services } from '../helpers/makeApp.js';

// Never reach X: every post is stubbed and reported as simulated.
vi.mock('../../server/twitterClient.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/twitterClient.js')>();
  return {
    ...actual,
    postColorTweet: vi.fn(async (_creds: unknown, options: { text: string }) => ({
      success: true,
      tweetId: 'sim_webhook',
      text: options.text,
      url: 'https://x.com/i/status/sim_webhook',
      simulated: true,
    })),
  };
});

let app: ReturnType<typeof makeApp>;
let secret: string;

beforeAll(() => {
  app = makeApp();
  secret = services.credentials.getWebhookSecret();
});

beforeEach(() => {
  vi.mocked(postColorTweet).mockClear();
  services.settings.updateSettings({ globalPaused: false, globalDryRun: true });
});

describe('webhook trigger (SEC-3)', () => {
  it('rejects a missing secret with 401', async () => {
    const res = await request(app).post('/api/webhook/trigger').expect(401);
    expect(res.body).toEqual({ success: false, error: expect.any(String) });
  });

  it('rejects a wrong secret (header and query) with 401', async () => {
    await request(app).post('/api/webhook/trigger').set('x-cron-secret', 'nope').expect(401);
    await request(app).get('/api/cron/trigger').query({ secret: 'nope' }).expect(401);
    expect(postColorTweet).not.toHaveBeenCalled();
  });

  it('GET can never post live, even with forceLive', async () => {
    const res = await request(app)
      .get('/api/webhook/trigger')
      .query({ forceLive: 'true' })
      .set('x-cron-secret', secret)
      .expect(200);
    expect(res.body.result.simulated).toBe(true);
    expect(postColorTweet).toHaveBeenCalled();
    // Third argument is `isDryRun`: it must never be false for a GET ping.
    for (const call of vi.mocked(postColorTweet).mock.calls) expect(call[2]).toBe(true);
  });

  it('POST with the header secret works and is a dry run', async () => {
    const res = await request(app)
      .post('/api/webhook/trigger')
      .set('x-cron-secret', secret)
      .send({})
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(vi.mocked(postColorTweet).mock.calls.at(-1)![2]).toBe(true);
    expect(res.body.result.simulated).toBe(true);
  });

  it('status and settings never contain the secret', async () => {
    const status = await request(app).get('/api/status').expect(200);
    expect(JSON.stringify(status.body)).not.toContain(secret);
    const settings = await request(app).get('/api/settings');
    expect(JSON.stringify(settings.body)).not.toContain(secret);
  });
});
