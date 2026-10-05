/**
 * X ChromaBot - campaign flows
 * Create, edit (target URL, fixed times, timezone, jitter, template, dry run), pause/resume and
 * delete with the ConfirmDialog. The campaign form is the one place that configures a campaign.
 */

import type { Page } from '@playwright/test';
import { test, expect, openApp, campaignCard, PRIMARY } from './fixtures.js';

const NAME = 'E2E Campaign';
const TWEET_ID = '1234567890123456789';

/** The campaign name as rendered on a card. */
const shownName = (page: Page) => page.getByText(NAME, { exact: true }).locator('visible=true');

test('campaign lifecycle: create, edit schedule + template, pause/resume, delete', async ({
  app,
}) => {
  await openApp(app); // Campaigns is the landing screen

  // Create
  await app.getByRole('button', { name: /Add Tweet Context/ }).click();
  const form = app.locator('form');
  await form.getByPlaceholder(/Morning Thread, Daily Quotes/).fill(NAME);
  await form.getByPlaceholder(/Tweet ID or https/).fill(TWEET_ID);
  await form.getByRole('button', { name: 'Create Context' }).click();
  await expect(shownName(app)).toBeVisible();
  await expect(app.getByText('2 campaigns')).toBeVisible();

  // Edit: target URL + fixed times + timezone + jitter + template + dry run
  await campaignCard(app, NAME).getByTitle('Edit context & schedule').click();
  await form.getByPlaceholder(/Tweet ID or https/).fill('https://x.com/someone/status/9876543210');
  await expect(form.getByText('Clean ID detected: 9876543210')).toBeVisible();
  await app.getByRole('button', { name: /Fixed Clock Drops/ }).click();
  const times = app.getByPlaceholder('06:00, 18:00');
  await times.fill('7:05, 19:30');
  await times.blur();
  await expect(times).toHaveValue('07:05, 19:30');
  await app
    .locator('form select')
    .filter({ hasText: 'America/Denver' })
    .selectOption('Europe/London');
  await app.getByRole('button', { name: 'Reset to Default Formula' }).click();
  await app.getByRole('button', { name: '+ {hex}' }).click();
  await expect(app.locator('form textarea')).toHaveValue(/\{hex\}$/);
  const jitter = form.locator('input[type="range"]');
  await jitter.focus();
  await jitter.press('ArrowRight'); // 25% -> 30%
  await expect(jitter).toHaveValue('30');
  await form.getByLabel('Posting Mode').selectOption('simulated');
  await app.getByRole('button', { name: 'Save & Regenerate Queue' }).click();
  await expect(app.getByRole('button', { name: 'Save & Regenerate Queue' })).toHaveCount(0);

  const { contexts } = await (await app.request.get('/api/status')).json();
  const saved = contexts.find((c: { name: string }) => c.name === NAME);
  expect(saved.targetTweetId).toBe('9876543210');
  expect(saved.dryRun).toBe(true);
  expect(saved.schedule).toMatchObject({
    mode: 'fixed_times',
    scheduleTimes: ['07:05', '19:30'],
    timezone: 'Europe/London',
    jitterPercentage: 30,
  });
  expect(saved.template).toContain('{hex}');

  // Survives a reload (server is the source of truth); the card shows the campaign's dry run
  await app.reload();
  const card = campaignCard(app, NAME);
  await expect(card.getByRole('button', { name: 'Campaign dry run: on' })).toBeVisible();
  await expect(card).toContainText('#9876543210');
  await card.getByTitle('Edit context & schedule').click();
  await expect(form.getByPlaceholder(/Tweet ID or https/)).toHaveValue('9876543210');
  await expect(form.getByPlaceholder('06:00, 18:00')).toHaveValue('07:05, 19:30');
  await expect(form.getByLabel('Timezone')).toHaveValue('Europe/London');
  await app.getByRole('button', { name: 'Cancel' }).click();

  // Invalid times are refused with a clear message
  await campaignCard(app, NAME).getByTitle('Edit context & schedule').click();
  await app.getByPlaceholder('06:00, 18:00').fill('25:99');
  await app.getByRole('button', { name: 'Save & Regenerate Queue' }).click();
  await expect(app.getByText(/Invalid time\(s\): 25:99/).first()).toBeVisible();
  await app.getByRole('button', { name: 'Cancel' }).click();

  // Pause / resume
  await app
    .getByTitle(/Click to (Pause|Resume) this campaign/)
    .last()
    .click();
  await expect(app.getByTitle('Click to Resume this campaign')).toHaveCount(1);
  await app.getByTitle('Click to Resume this campaign').click();
  await expect(app.getByTitle('Click to Resume this campaign')).toHaveCount(0);

  // Delete: cancel first, then confirm
  await app.getByTitle('Delete context').last().click();
  await expect(app.getByRole('alertdialog')).toContainText(`delete context "${NAME}"`);
  await app.getByRole('button', { name: 'Cancel' }).click();
  await expect(shownName(app)).toBeVisible();
  await app.getByTitle('Delete context').last().click();
  await app.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(shownName(app)).toHaveCount(0);
  await expect(app.getByText('1 campaign', { exact: true })).toBeVisible();
});

test('the card has a one-click 1-minute frequency', async ({ app }) => {
  const { contexts } = await (await app.request.get('/api/status')).json();
  const primary = contexts[0];
  await openApp(app);
  const card = campaignCard(app, PRIMARY);
  await card.getByRole('button', { name: '1m', exact: true }).click();
  await expect(card.getByText('Every 1m')).toBeVisible();
  await expect
    .poll(async () => {
      const { contexts: now } = await (await app.request.get('/api/status')).json();
      return now[0].schedule.intervalMinutes;
    })
    .toBe(1);
  await app.request.put(`/api/contexts/${primary.id}`, { data: { schedule: primary.schedule } });
});
