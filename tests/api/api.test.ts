import request from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import * as templateAgent from '../../server/templateAgent.js';
import { postColorTweet } from '../../server/twitterClient.js';
import { makeApp, services } from '../helpers/makeApp.js';

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
    const ctx = services.contexts.createContext({
      name: 'Dry',
      targetTweetId: '1234567890123456789',
      dryRun: true,
    });
    const before = services.logs.getLogs().length;

    const res = await request(app)
      .post('/api/post-now')
      .send({ contextId: ctx.id, slotType: 'morning' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.result.simulated).toBe(true);
    expect(res.body.log.status).toBe('simulated');
    expect(services.logs.getLogs().length).toBe(before + 1);
    expect(services.logs.getLogs()[0].contextId).toBe(ctx.id);
  });

  it('posts the supplied text verbatim without resolving the template', async () => {
    const ctx = services.contexts.createContext({
      name: 'Verbatim',
      targetTweetId: '1234567890123456789',
      dryRun: true,
      template: 'TEMPLATE <agent>',
    });
    const res = await request(app)
      .post('/api/post-now')
      .send({ contextId: ctx.id, slotType: 'manual', text: 'exactly this preview' })
      .expect(200);
    expect(res.body.log.tweetText).toBe('exactly this preview');
    expect(vi.mocked(postColorTweet).mock.calls.at(-1)![1]).toMatchObject({
      text: 'exactly this preview',
    });
  });

  it('rejects over-long or non-string text with 400', async () => {
    const ctx = services.contexts.createContext({ name: 'Long', dryRun: true });
    await request(app)
      .post('/api/post-now')
      .send({ contextId: ctx.id, text: 'x'.repeat(281) })
      .expect(400);
    await request(app).post('/api/post-now').send({ contextId: ctx.id, text: 5 }).expect(400);
  });

  it('consumes the queue slot that was sent', async () => {
    const ctx = services.contexts.createContext({
      name: 'Slots',
      targetTweetId: '1234567890123456789',
      dryRun: true,
    });
    services.queue.ensureQueue(ctx.id);
    const before = services.queue.getQueue(ctx.id);
    const slot = before[1];
    await request(app)
      .post('/api/post-now')
      .send({ contextId: ctx.id, slotType: slot.slotType, color: slot.color, slotId: slot.slotId })
      .expect(200);
    const after = services.queue.getQueue(ctx.id);
    expect(after.some((q) => q.slotId === slot.slotId)).toBe(false);
    expect(after.length).toBe(before.length); // topped back up
  });

  it('returns 404 for an unknown context', async () => {
    await request(app).post('/api/post-now').send({ contextId: 'ctx_nope' }).expect(404);
  });
});

describe('POST /api/generate-color', () => {
  it('returns only a color and never touches the template/Gemini path', async () => {
    const spy = vi.spyOn(templateAgent, 'resolveTemplateText');
    const res = await request(app)
      .post('/api/generate-color')
      .send({ slotType: 'morning' })
      .expect(200);
    expect(Object.keys(res.body)).toEqual(['color']);
    expect(res.body.color).toHaveProperty('hex');
    expect(spy).not.toHaveBeenCalled();
  });
});
