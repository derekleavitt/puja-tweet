/**
 * X ChromaBot - status-driven UI
 * Global switches in Settings vs per-campaign switches on the card, the all-campaign status bar,
 * server-default target prefill, the "AI unavailable" notice (the e2e server has no
 * GEMINI_API_KEY) and the accurate footer environment line.
 */

import type { Page } from '@playwright/test';
import { test, expect, openApp, openTab, campaignCard, PRIMARY } from './fixtures.js';

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

test('Settings holds the global switches (driving the header pills); campaign switches are on the card', async ({
  app,
}) => {
  await openApp(app);
  // Per-campaign switches live on the campaign card
  const card = campaignCard(app, PRIMARY);
  await expect(card.getByRole('button', { name: /Campaign dry run: (on|off)/ })).toBeVisible();
  await expect(card.getByTitle(/Click to (Pause|Resume) this campaign/)).toBeVisible();

  await openTab(app, 'Settings');
  const global = app.getByRole('region', { name: 'All campaigns' });
  await expect(global).toContainText('apply immediately');
  await expect(app.getByRole('region', { name: 'This campaign' })).toHaveCount(0);
  await expect(global.getByLabel(/Campaign dry run/)).toHaveCount(0);

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

  // Editing a campaign whose target is unset starts from the server default
  await campaignCard(app, PRIMARY).getByTitle('Edit context & schedule').click();
  await expect(app.getByPlaceholder(/Tweet ID or https/)).toHaveValue(SERVER_DEFAULT_TARGET);
  await app.getByRole('button', { name: 'Cancel' }).click();

  await app.getByRole('button', { name: /Add Tweet Context/ }).click();
  await expect(app.getByPlaceholder(/Tweet ID or https/)).toHaveValue(SERVER_DEFAULT_TARGET);
});

test('the real server default is reported by /api/status', async ({ app }) => {
  const status = await (await app.request.get('/api/status')).json();
  expect(status.defaultTargetTweetId).toBe('1700000000000000001');
  expect(status.geminiConfigured).toBe(false);
});

test('AI unavailable badge shows in the campaign form and an AI campaign preview; AI test is disabled', async ({
  app,
  expectError,
}) => {
  // An AI-only template cannot be rendered without Gemini: the server answers 503 on purpose.
  expectError(/503 .*\/api\/template\/preview/);
  expectError(/status of 503 .*\/api\/template\/preview/);
  const created = await (
    await app.request.post('/api/contexts', {
      data: {
        name: 'AI Campaign',
        targetTweetId: '1700000000000000007',
        template: '<agent>Write one short line about the sea</agent>',
      },
    })
  ).json();
  try {
    await openApp(app);
    const badge = app.getByRole('status').filter({ hasText: 'AI unavailable' });

    // The preview of an AI-only campaign says AI is off, explains why, and cannot post
    const card = campaignCard(app, 'AI Campaign');
    await card.getByRole('button', { name: 'Preview & post' }).click();
    const panel = card.getByTestId('campaign-preview');
    await expect(panel.getByRole('status').filter({ hasText: 'AI unavailable' })).toBeVisible();
    await expect(panel).toContainText('GEMINI_API_KEY');
    await expect(panel.getByRole('button', { name: /Post now/ })).toBeDisabled();

    await campaignCard(app, PRIMARY).getByTitle('Edit context & schedule').click();
    await expect(badge.first()).toBeVisible();
    const test = app.locator('form').getByRole('button', { name: /Test AI Generation Now/ });
    await expect(test).toBeDisabled();
    await expect(test).toHaveAttribute('title', /GEMINI_API_KEY/);
    await app.getByRole('button', { name: 'Cancel' }).click();

    await app.getByRole('button', { name: /Add Tweet Context/ }).click();
    await expect(app.locator('form').getByRole('status').first()).toContainText('AI unavailable');
    await expect(
      app.locator('form').getByRole('button', { name: /Test AI Generation/ }),
    ).toBeDisabled();
  } finally {
    await app.request.delete(`/api/contexts/${created.context.id}`);
  }
});

test('the status bar summarises the next post across campaigns with its blocked reason', async ({
  app,
}) => {
  await openApp(app);
  const next = app.getByTestId('status-next-post');
  await expect(next).toContainText(PRIMARY);
  // Global pause is on in the e2e server: the scheduler says why it will not post
  await expect(app.getByTestId('scheduler-blocked-reason')).toBeVisible();
  await expect(app.getByTestId('status-campaign-count')).toContainText('Scheduled: 1 of 1');
});

test('footer states the dev auth bypass instead of claiming Google auth', async ({ app }) => {
  await openApp(app);
  const env = app.getByTestId('footer-env');
  await expect(env).toHaveText('Dev mode — auth bypassed');
  await expect(app.getByText(/Google Auth Active/)).toHaveCount(0);
});
