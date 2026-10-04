import request from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { makeApp, storage } from '../helpers/makeApp.js';

// Never reach X: stub the posting call. Dry-run results are simulated, as in production.
vi.mock('../../server/twitterClient.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/twitterClient.js')>();
  return {
    ...actual,
    postColorTweet: vi.fn(async (_creds: unknown, options: any) => ({
      success: true,
      tweetId: 'sim_test',
      text: options.text,
      replyTo: options.replyToTweetId,
      engagementMode: options.engagementMode,
      url: 'https://x.com/i/status/sim_test',
      simulated: true,
    })),
  };
});

let app: ReturnType<typeof makeApp>;

beforeAll(() => {
  app = makeApp();
});

describe('GET /api/status', () => {
  it('returns the dashboard shape', async () => {
    const res = await request(app).get('/api/status').expect(200);
    expect(res.body).toMatchObject({
      settings: expect.any(Object),
      activeContext: expect.objectContaining({ id: expect.any(String) }),
      contexts: expect.any(Array),
      stats: {
        totalPosts: expect.any(Number),
        successfulPosts: expect.any(Number),
        simulatedPosts: expect.any(Number),
        failedPosts: expect.any(Number),
      },
      queue: expect.any(Array),
    });
    expect(res.body).toHaveProperty('cooldownState');
    expect(res.body).toHaveProperty('credentialsStatus');
  });
});

describe('contexts', () => {
  it('rejects invalid input with 400 and { success:false, error }', async () => {
    const res = await request(app).post('/api/contexts').send({ name: 123 }).expect(400);
    expect(res.body).toEqual({ success: false, error: expect.any(String) });
  });

  it('returns 404 for an unknown context id', async () => {
    const res = await request(app).put('/api/contexts/ctx_missing').send({}).expect(404);
    expect(res.body).toEqual({ success: false, error: expect.stringContaining('ctx_missing') });
  });

  it('creates a context', async () => {
    const res = await request(app)
      .post('/api/contexts')
      .send({ name: 'Test Campaign', targetTweetId: '1234567890123456789' })
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.context.name).toBe('Test Campaign');
    expect(res.body.context.targetTweetId).toBe('1234567890123456789');
  });
});

describe('POST /api/post-now', () => {
  it('in dry-run returns simulated:true and appends a log', async () => {
    const ctx = storage.createContext({ name: 'Dry', targetTweetId: '1234567890123456789', dryRun: true });
    const before = storage.getLogs().length;

    const res = await request(app)
      .post('/api/post-now')
      .send({ contextId: ctx.id, slotType: 'morning' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.result.simulated).toBe(true);
    expect(res.body.log.status).toBe('simulated');
    expect(storage.getLogs().length).toBe(before + 1);
    expect(storage.getLogs()[0].contextId).toBe(ctx.id);
  });

  it('returns 404 for an unknown context', async () => {
    await request(app).post('/api/post-now').send({ contextId: 'ctx_nope' }).expect(404);
  });
});
