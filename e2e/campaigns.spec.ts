/**
 * X ChromaBot - campaign flows
 * Create, edit (fixed times, timezone, template), pause/resume and delete with the ConfirmDialog.
 */

import type { Page } from '@playwright/test';
import { test, expect, openApp, openTab } from './fixtures.js';

const NAME = 'E2E Campaign';
const TWEET_ID = '1234567890123456789';

/** The campaign name as rendered on a card (the header select also lists it in hidden options). */
const shownName = (page: Page) => page.getByText(NAME, { exact: true }).locator('visible=true');

test('campaign lifecycle: create, edit schedule + template, pause/resume, delete', async ({
  app,
}) => {
  await openApp(app);
  await openTab(app, 'Campaigns');

  // Create
  await app.getByRole('button', { name: /Add Tweet Context/ }).click();
  const form = app.locator('form');
  await form.getByPlaceholder(/Primary Eternal Colors, Morning/).fill(NAME);
  await form.getByPlaceholder(/Tweet ID or https/).fill(TWEET_ID);
  await form.getByRole('button', { name: 'Create Context' }).click();
  await expect(shownName(app)).toBeVisible();
  await expect(app.getByText('2 campaigns')).toBeVisible();

  // Edit: fixed times + timezone + template through the TemplateEditor
  await app.getByTitle('Edit context & schedule').last().click();
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
  await app.getByRole('button', { name: 'Save & Regenerate Queue' }).click();
  await expect(app.getByRole('button', { name: 'Save & Regenerate Queue' })).toHaveCount(0);

  const { contexts } = await (await app.request.get('/api/status')).json();
  const saved = contexts.find((c: { name: string }) => c.name === NAME);
  expect(saved.schedule).toMatchObject({
    mode: 'fixed_times',
    scheduleTimes: ['07:05', '19:30'],
    timezone: 'Europe/London',
  });
  expect(saved.template).toContain('{hex}');

  // Invalid times are refused with a clear message
  await app.getByTitle('Edit context & schedule').last().click();
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
