import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateColor } from '../../server/colorEngine.js';
import { makeApp, services } from '../helpers/makeApp.js';

// Never reach X: every post is a simulated success.
vi.mock('../../server/twitterClient.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/twitterClient.js')>();
  return {
    ...actual,
    postColorTweet: vi.fn(async (_creds: unknown, options: { text: string }) => ({
      success: true,
      tweetId: 'sim_test',
      text: options.text,
      simulated: true,
    })),
  };
});

let app: ReturnType<typeof makeApp>;

beforeAll(() => {
  app = makeApp();
});

beforeEach(() => {
  vi.stubEnv('GEMINI_API_KEY', ''); // offline generator only: no network in tests
});

const create = async (body: Record<string, unknown>) =>
  (await request(app).post('/api/contexts').send(body).expect(200)).body.context;

describe('hashtagEvolution schema', () => {
  it('defaults to off with maxTags 3', async () => {
    const ctx = await create({ name: 'Plain' });
    expect(ctx.hashtagEvolution).toEqual({ enabled: false, maxTags: 3, keepSeedTags: false });
    expect(ctx).not.toHaveProperty('hashtagState');
  });

  it('accepts config on create and merges partial updates over the current config', async () => {
    const ctx = await create({
      name: 'Evolving',
      hashtagEvolution: { enabled: true, maxTags: 4 },
    });
    expect(ctx.hashtagEvolution).toEqual({ enabled: true, maxTags: 4, keepSeedTags: false });
    const res = await request(app)
      .put(`/api/contexts/${ctx.id}`)
      .send({ hashtagEvolution: { keepSeedTags: true } })
      .expect(200);
    expect(res.body.context.hashtagEvolution).toEqual({
      enabled: true,
      maxTags: 4,
      keepSeedTags: true,
    });
  });

  it('rejects an out-of-range maxTags with 400', async () => {
    for (const maxTags of [0, 6, 2.5, 'three']) {
      const res = await request(app)
        .post('/api/contexts')
        .send({ name: 'Bad', hashtagEvolution: { enabled: true, maxTags } })
        .expect(400);
      expect(res.body.error).toContain('hashtagEvolution');
    }
  });

  it('never lets a client set hashtagState (create or update)', async () => {
    const evil = { current: ['Evil'], recent: ['Evil'] };
    const created = await create({ name: 'Evil', hashtagState: evil });
    expect(created).not.toHaveProperty('hashtagState');
    const res = await request(app)
      .put(`/api/contexts/${created.id}`)
      .send({ hashtagState: evil, hashtagEvolution: { enabled: true } })
      .expect(200);
    expect(res.body.context).not.toHaveProperty('hashtagState');
    expect(services.contexts.getContext(created.id)?.hashtagState).toBeUndefined();
  });
});

describe('preview -> post-now', () => {
  it('previews evolved tags, posts exactly that text, and advances the state once', async () => {
    const ctx = await create({
      name: 'Flow',
      targetTweetId: '1234567890123456789',
      dryRun: true,
      template: '{color_pick} {weather_desc} #eternal #colors',
      hashtagEvolution: { enabled: true, maxTags: 3 },
    });
    const color = generateColor('morning');

    const preview = (
      await request(app)
        .post('/api/template/preview')
        .send({ contextId: ctx.id, color })
        .expect(200)
    ).body;
    expect(preview.hashtags.length).toBeGreaterThan(0);
    // Whole-tag check: evolved tags may legitimately start with a seed word (e.g. #eternalLove).
    expect(preview.previewText).not.toMatch(/#(eternal|colors)(?![\p{L}\p{N}_])/iu);
    for (const tag of preview.hashtags) expect(preview.previewText).toContain(`#${tag}`);
    // Previewing is read-only: it never advances the stored state.
    expect(services.contexts.getContext(ctx.id)?.hashtagState).toBeUndefined();

    const posted = (
      await request(app)
        .post('/api/post-now')
        .send({
          contextId: ctx.id,
          slotType: 'manual',
          color,
          text: preview.previewText,
          hashtags: preview.hashtags,
        })
        .expect(200)
    ).body;
    expect(posted.log.tweetText).toBe(preview.previewText);
    expect(posted.hashtags).toEqual(preview.hashtags);
    expect(services.contexts.getContext(ctx.id)?.hashtagState?.current).toEqual(preview.hashtags);

    const status = (await request(app).get('/api/status').expect(200)).body;
    const fromStatus = status.contexts.find((c: { id: string }) => c.id === ctx.id);
    expect(fromStatus.hashtagState.current).toEqual(preview.hashtags);
  });

  it('does not include hashtags when evolution is off', async () => {
    const ctx = await create({ name: 'Off', template: '{color_pick} #eternal' });
    const preview = (
      await request(app)
        .post('/api/template/preview')
        .send({ contextId: ctx.id, color: generateColor('morning') })
        .expect(200)
    ).body;
    expect(preview).not.toHaveProperty('hashtags');
    expect(preview.previewText).toContain('#eternal');
  });
});
