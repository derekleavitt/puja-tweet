/**
 * X ChromaBot - campaign isolation through the UI
 * Every per-campaign control lives on that campaign's card / form, so editing, previewing or
 * posting campaign B never touches campaign A; a new campaign never inherits another campaign's
 * target; the Queue and Logs screens filter by campaign without changing any server state.
 */

import type { Page } from '@playwright/test';
import { test, expect, openApp, openTab, openPreview, campaignCard, PRIMARY } from './fixtures.js';

const SERVER_DEFAULT_TARGET = '1700000000000000001';
const B_NAME = 'Campaign B';
const B_TARGET = '2000000000000000002';

interface Ctx {
  id: string;
  name: string;
  targetTweetId: string;
  template: string;
  enabled: boolean;
  dryRun?: boolean;
  engagementMode?: string;
  replyTargetMode?: string;
  autoFallbackToQuote?: boolean;
  schedule: Record<string, unknown>;
  hashtagEvolution?: unknown;
  stats?: { totalPosts: number };
  updatedAt?: string;
}
const contexts = async (page: Page): Promise<Ctx[]> =>
  (await (await page.request.get('/api/contexts')).json()).contexts;

/** Everything a campaign owner can configure (what must never leak across campaigns). */
const config = (c: Ctx) => ({
  name: c.name,
  targetTweetId: c.targetTweetId,
  template: c.template,
  enabled: c.enabled,
  dryRun: c.dryRun,
  engagementMode: c.engagementMode,
  replyTargetMode: c.replyTargetMode,
  autoFallbackToQuote: c.autoFallbackToQuote,
  schedule: c.schedule,
  hashtagEvolution: c.hashtagEvolution,
  stats: c.stats,
  updatedAt: c.updatedAt,
});

test('editing, previewing and posting campaign B never changes campaign A', async ({ app }) => {
  await app.request.delete('/api/history');
  const created = await (
    await app.request.post('/api/contexts', {
      data: { name: B_NAME, targetTweetId: B_TARGET, template: 'B {hex}', enabled: false },
    })
  ).json();
  const B: string = created.context.id;
  const primaryBefore = (await contexts(app)).find((c) => c.id !== B)!;

  await openApp(app);
  const cardB = campaignCard(app, B_NAME);

  // Full edit of B through its own form
  await cardB.getByTitle('Edit context & schedule').click();
  const form = app.locator('form');
  await expect(form.getByPlaceholder(/Tweet ID or https/)).toHaveValue(B_TARGET);
  await form
    .getByPlaceholder(/Tweet ID or https/)
    .fill('https://x.com/b/status/3000000000000000003');
  await expect(form.getByText('Clean ID detected: 3000000000000000003')).toBeVisible();
  await form.getByRole('button', { name: /Reply to Last Comment/ }).click();
  await form.getByRole('button', { name: /Fixed Clock Drops/ }).click();
  await form.getByPlaceholder('06:00, 18:00').fill('09:10');
  await form.getByLabel('Timezone').selectOption('Asia/Tokyo');
  const jitter = form.locator('input[type="range"]');
  await jitter.focus();
  for (let i = 0; i < 3; i++) await jitter.press('ArrowLeft'); // 25% -> 10%
  await expect(jitter).toHaveValue('10');
  await form.locator('textarea').fill('B edited {color_pick}');
  await form.getByLabel('Posting Mode').selectOption('simulated');
  await expect(form.getByLabel('Campaign webhook URL')).toHaveValue(new RegExp(`contextId=${B}$`));
  await app.getByRole('button', { name: 'Save & Regenerate Queue' }).click();
  await expect(app.getByRole('button', { name: 'Save & Regenerate Queue' })).toHaveCount(0);

  // Quick controls on B's card
  await cardB.getByRole('button', { name: '30m', exact: true }).click();
  await cardB.getByRole('button', { name: 'Quote Tweet' }).click();
  await cardB.getByRole('button', { name: 'Campaign dry run: on' }).click();
  await expect(cardB.getByRole('button', { name: 'Campaign dry run: off' })).toBeVisible();
  await cardB.getByTitle('Click to Resume this campaign').click();
  await expect(cardB.getByTitle('Click to Pause this campaign')).toBeVisible();

  // Preview + post B (simulated: global dry run)
  const panel = await openPreview(app, B_NAME);
  await expect(panel.getByTestId('tweet-preview-text')).toContainText('B edited');
  await panel.getByRole('button', { name: 'Post now (simulated)' }).click();
  await expect(panel.getByText('Reply Simulated Successfully')).toBeVisible();

  const after = await contexts(app);
  const b = after.find((c) => c.id === B)!;
  expect(b).toMatchObject({
    targetTweetId: '3000000000000000003',
    template: 'B edited {color_pick}',
    replyTargetMode: 'last_comment',
    engagementMode: 'quote',
    enabled: true,
    dryRun: false,
  });
  expect(b.schedule).toMatchObject({
    mode: 'interval',
    intervalMinutes: 30,
    scheduleTimes: ['09:10'],
    timezone: 'Asia/Tokyo',
    jitterPercentage: 10,
  });
  // A is byte-for-byte what it was: config, stats and even updatedAt
  expect(config(after.find((c) => c.id === primaryBefore.id)!)).toEqual(config(primaryBefore));
  const { logs } = await (await app.request.get('/api/history')).json();
  expect(logs).toHaveLength(1);
  expect(logs[0].contextId).toBe(B);

  // Queue and Logs filter by campaign (a UI filter: no server state changes)
  await openTab(app, 'Queue');
  await app.getByLabel('Queue campaign').selectOption(B);
  await expect(app.getByTestId('queue-slot').first()).toContainText('B edited');
  await app.getByLabel('Queue campaign').selectOption(primaryBefore.id);
  await expect(app.getByTestId('queue-slot').first()).not.toContainText('B edited');
  await openTab(app, 'Logs');
  await app.getByLabel('Filter by campaign').selectOption(primaryBefore.id);
  await expect(app.getByText('No post logs recorded yet')).toBeVisible();
  await app.getByLabel('Filter by campaign').selectOption(B);
  await expect(app.getByTestId('history-tweet-text')).toHaveCount(1);
  expect(config((await contexts(app)).find((c) => c.id === primaryBefore.id)!)).toEqual(
    config(primaryBefore),
  );
});

test("the new-campaign form never prefills another campaign's target", async ({ app }) => {
  await openApp(app);
  await campaignCard(app, PRIMARY).getByTitle('Edit context & schedule').click();
  await app
    .locator('form')
    .getByPlaceholder(/Tweet ID or https/)
    .fill('1234567890123456789');
  await app.getByRole('button', { name: 'Save & Regenerate Queue' }).click();
  await expect(app.getByRole('button', { name: 'Save & Regenerate Queue' })).toHaveCount(0);

  await app.getByRole('button', { name: /Add Tweet Context/ }).click();
  await expect(app.getByPlaceholder(/Tweet ID or https/)).toHaveValue(SERVER_DEFAULT_TARGET);
  await app.getByRole('button', { name: 'Cancel' }).click();
});

test.afterEach(async ({ request }) => {
  const { contexts: all } = await (await request.get('/api/contexts')).json();
  for (const c of all as Ctx[]) {
    if (c.name === B_NAME) await request.delete(`/api/contexts/${c.id}`);
  }
  const primary = (all as Ctx[]).find((c) => c.name === PRIMARY);
  if (primary) {
    await request.put(`/api/contexts/${primary.id}`, {
      data: { targetTweetId: SERVER_DEFAULT_TARGET },
    });
  }
  await request.delete('/api/history');
});
