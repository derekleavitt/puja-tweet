/**
 * X ChromaBot - status-driven UI
 * Global vs per-campaign switches, server-default target prefill, the "AI unavailable" notice (the
 * e2e server has no GEMINI_API_KEY) and the accurate footer environment line.
 */

import type { Page } from '@playwright/test';
import { test, expect, openApp, openTab } from './fixtures.js';

const SERVER_DEFAULT_TARGET = '1888888888888888888';

/** Serves /api/status as if no campaign had a target tweet and the server default were a sentinel. */
async function withEmptyTargets(page: Page) {
  await page.route('**/api/status', async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    const blank = <T extends { targetTweetId?: string }>(o: T): T => ({ ...o, targetTweetId: '' });
    await route.fulfill({
      response: res,
      json: {
        ...body,
        defaultTargetTweetId: SERVER_DEFAULT_TARGET,
        settings: blank(body.settings),
        activeContext: body.activeContext ? blank(body.activeContext) : body.activeContext,
        contexts: body.contexts.map(blank),
      },
    });
  });
}

test('Timing separates the global switches from this campaign and drives the header pills', async ({
  app,
}) => {
  await openApp(app);
  await openTab(app, 'Timing');

  const global = app.getByRole('region', { name: 'All campaigns' });
  const local = app.getByRole('region', { name: 'This campaign' });
  await expect(global).toContainText('apply immediately');
  await expect(local).toContainText('Primary Eternal Colors');
  await expect(local.getByLabel(/Campaign dry run/)).toBeVisible();
  await expect(local.getByLabel(/Campaign scheduler/)).toBeVisible();

  // Same state as the header pills: dry run and pause start on
  const dryRun = global.getByLabel(/Global dry run/);
  const pauseAll = global.getByLabel(/Pause all campaigns/);
  await expect(dryRun).toBeChecked();
  await expect(pauseAll).toBeChecked();
  await expect(app.getByRole('button', { name: /^Dry Run$/ })).toBeVisible();

  await dryRun.click();
  await expect(dryRun).not.toBeChecked();
  await expect(app.getByRole('button', { name: /^Live X API$/ })).toBeVisible();
  await pauseAll.click();
  await expect(pauseAll).not.toBeChecked();
  await expect(app.getByRole('button', { name: 'Running' })).toBeVisible();
  let { settings } = await (await app.request.get('/api/status')).json();
  expect(settings).toMatchObject({ globalDryRun: false, globalPaused: false });

  // Restore the safe defaults for the rest of the suite
  await dryRun.click();
  await expect(dryRun).toBeChecked();
  await pauseAll.click();
  await expect(pauseAll).toBeChecked();
  await expect(app.getByRole('button', { name: /^Dry Run$/ })).toBeVisible();
  await expect(app.getByRole('button', { name: 'Paused' })).toBeVisible();
  ({ settings } = await (await app.request.get('/api/status')).json());
  expect(settings).toMatchObject({ globalDryRun: true, globalPaused: true });
});

test('empty target tweet fields start from the server default', async ({ app }) => {
  await withEmptyTargets(app);
  await openApp(app);

  await openTab(app, 'Timing');
  await expect(app.getByPlaceholder('Tweet ID or https://x.com/...')).toHaveValue(
    SERVER_DEFAULT_TARGET,
  );

  await openTab(app, 'Campaigns');
  await app.getByRole('button', { name: /Add Tweet Context/ }).click();
  await expect(app.getByPlaceholder(/Tweet ID or https/)).toHaveValue(SERVER_DEFAULT_TARGET);
});

test('the real server default is reported by /api/status', async ({ app }) => {
  const status = await (await app.request.get('/api/status')).json();
  expect(status.defaultTargetTweetId).toBe('1700000000000000001');
  expect(status.geminiConfigured).toBe(false);
});

test('AI unavailable badge shows in Studio, Timing and the campaign form; AI test is disabled', async ({
  app,
}) => {
  await openApp(app);
  const badge = app.getByRole('status').filter({ hasText: 'AI unavailable' });

  await expect(badge.first()).toBeVisible(); // Studio is the landing tab

  await openTab(app, 'Timing');
  await expect(badge.first()).toBeVisible();
  const test = app.getByRole('button', { name: /Test AI Generation Now/ });
  await expect(test).toBeDisabled();
  await expect(test).toHaveAttribute('title', /GEMINI_API_KEY/);

  await openTab(app, 'Campaigns');
  await app.getByRole('button', { name: /Add Tweet Context/ }).click();
  await expect(app.locator('form').getByRole('status').first()).toContainText('AI unavailable');
  await expect(
    app.locator('form').getByRole('button', { name: /Test AI Generation/ }),
  ).toBeDisabled();
});

test('footer states the dev auth bypass instead of claiming Google auth', async ({ app }) => {
  await openApp(app);
  const env = app.getByTestId('footer-env');
  await expect(env).toHaveText('Dev mode — auth bypassed');
  await expect(app.getByText(/Google Auth Active/)).toHaveCount(0);
});
