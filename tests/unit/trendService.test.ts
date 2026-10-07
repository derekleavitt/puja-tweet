import { describe, expect, it, vi } from 'vitest';
import {
  createTrendService,
  trendTags,
  TRENDS_CACHE_MS,
  TRENDS_REFUSED_MS,
} from '../../server/services/trendService.js';

const json = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const trends = {
  data: [{ trend_name: '#Coffee' }, { trend_name: 'World Cup' }, { trend_name: '#2026' }],
};

const make = (fetchImpl: ReturnType<typeof vi.fn>, woeid = '23424977') => {
  let now = 1_000_000;
  const service = createTrendService({
    woeid: () => woeid,
    bearerToken: () => 'app-token',
    fetch: fetchImpl as unknown as typeof fetch,
    now: () => now,
  });
  return { service, advance: (ms: number) => (now += ms) };
};

describe('trendTags', () => {
  it('turns trend names into valid tags (drops number-only ones and duplicates)', () => {
    expect(trendTags(trends)).toEqual(['Coffee', 'WorldCup']);
    expect(trendTags({ data: [{ trend_name: '#Coffee' }, { trend_name: 'coffee' }] })).toEqual([
      'Coffee',
    ]);
    expect(trendTags({})).toEqual([]);
  });
});

describe('trendService', () => {
  it('is off (no call) without X_TRENDS_WOEID', async () => {
    const fetchImpl = vi.fn();
    const { service } = make(fetchImpl, '');
    expect(await service.getTrendingHashtags()).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reads trends for the WOEID with the bearer token and caches them for an hour', async () => {
    const fetchImpl = vi.fn(async () => json(200, trends));
    const { service, advance } = make(fetchImpl);
    expect(await service.getTrendingHashtags()).toEqual(['Coffee', 'WorldCup']);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.x.com/2/trends/by/woeid/23424977');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer app-token');
    advance(TRENDS_CACHE_MS - 1);
    await service.getTrendingHashtags();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    advance(2);
    await service.getTrendingHashtags();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('switches off for a day when X refuses (plan without trends)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchImpl = vi.fn(async () => json(403, { title: 'Client Forbidden' }));
    const { service, advance } = make(fetchImpl);
    expect(await service.getTrendingHashtags()).toEqual([]);
    advance(TRENDS_REFUSED_MS - 1);
    expect(await service.getTrendingHashtags()).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    advance(2);
    await service.getTrendingHashtags();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('keeps serving the last good list when a later call fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json(200, trends))
      .mockRejectedValueOnce(new Error('network down'));
    const { service, advance } = make(fetchImpl);
    await service.getTrendingHashtags();
    advance(TRENDS_CACHE_MS + 1);
    expect(await service.getTrendingHashtags()).toEqual(['Coffee', 'WorldCup']);
  });
});
