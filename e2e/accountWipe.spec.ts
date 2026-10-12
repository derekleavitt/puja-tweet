/**
 * X ChromaBot - "Delete all content" of an X account (Settings → X accounts)
 * The e2e server has no X keys: one account and its wipe job are mocked with page.route; the rest
 * of the app is the real server.
 */

import type { Page } from '@playwright/test';
import { test, expect, openApp, openTab } from './fixtures.js';

const ID = 'acct_9001';

async function mockAccount(page: Page) {
  const state: { wipe?: Record<string, unknown>; confirm?: string; cancelled: boolean } = {
    cancelled: false,
  };
  const account = () => ({
    id: ID,
    label: '@wipe_me',
    handle: 'wipe_me',
    userId: '9001',
    status: 'ok',
    createdAt: new Date().toISOString(),
    lastVerifiedAt: new Date().toISOString(),
    isDefault: false,
    ...(state.wipe ? { wipe: state.wipe } : {}),
  });
  await page.route('**/api/status', async (route) => {
    const res = await route.fetch();
    const json = await res.json();
    json.accounts = [...(json.accounts ?? []), account()];
    await route.fulfill({ response: res, json });
  });
  await page.route(`**/api/accounts/${ID}/wipe`, async (route) => {
    state.confirm = route.request().postDataJSON().confirm;
    state.wipe = {
      status: 'running',
      simulate: true,
      phase: 'posts',
      pass: 1,
      counts: { posts: 12, retweets: 3, likes: 0, failed: 0 },
      queued: 0,
      startedAt: new Date().toISOString(),
    };
    await route.fulfill({ json: { success: true, pausedCampaigns: [], accounts: [account()] } });
  });
  await page.route(`**/api/accounts/${ID}/wipe/cancel`, async (route) => {
    state.cancelled = true;
    state.wipe = { ...state.wipe, status: 'cancelled', finishedAt: new Date().toISOString() };
    await route.fulfill({ json: { success: true, accounts: [account()] } });
  });
  return state;
}

test('delete all content: typed-handle confirm, progress, cancel', async ({ app }) => {
  const mock = await mockAccount(app);
  await openApp(app);
  await openTab(app, 'Settings');

  const row = app.locator(`[data-account-id="${ID}"]`);
  await row.getByRole('button', { name: 'Delete all content' }).click();
  const dialog = app.getByRole('alertdialog', { name: 'Delete all content of @wipe_me' });
  await expect(dialog).toBeVisible();
  // The e2e server starts in global dry run: the dialog says it only counts.
  await expect(dialog).toContainText('only counts what would be deleted');
  const start = dialog.getByRole('button', { name: 'Count content' });
  await expect(start).toBeDisabled();
  await dialog.getByLabel('Type the handle to confirm').fill('@wipe_you');
  await expect(start).toBeDisabled();
  await dialog.getByLabel('Type the handle to confirm').fill('@Wipe_Me');
  await expect(start).toBeEnabled();
  await start.click();
  await expect(dialog).toBeHidden();
  expect(mock.confirm).toBe('@Wipe_Me');

  const progress = row.getByTestId('wipe-progress');
  await expect(progress).toContainText('Counting (dry run)');
  await expect(progress).toContainText('12 posts, 3 retweets, 0 likes found');
  await expect(row.getByRole('button', { name: 'Delete all content' })).toBeDisabled();

  await progress.getByRole('button', { name: 'Cancel' }).click();
  await expect(progress).toContainText('Cancelled');
  expect(mock.cancelled).toBe(true);
});
