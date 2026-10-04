/**
 * X ChromaBot - settings and credentials flows
 */

import { test, expect, openApp, openTab } from './fixtures.js';

test('timing settings save, webhook URL is shown and the secret rotates behind a confirm', async ({
  app,
}) => {
  await openApp(app);
  await openTab(app, 'Timing');

  // Target + schedule + template
  await app
    .getByPlaceholder('Tweet ID or https://x.com/...')
    .fill('https://x.com/someone/status/9876543210');
  await expect(app.getByText('Clean ID detected: 9876543210')).toBeVisible();
  await app.getByRole('button', { name: /Fixed Clock Times/ }).click();
  const times = app.getByPlaceholder('06:00, 18:00');
  await times.fill('08:15, 20:45');
  await app.locator('select').filter({ hasText: 'America/Denver' }).selectOption('Asia/Tokyo');
  await app.getByRole('button', { name: 'Reset to Default Formula' }).click();
  await app.getByRole('button', { name: '+ {color_name}' }).click();
  await app.getByRole('button', { name: 'Save Settings' }).click();
  await expect(app.getByText('Settings Saved')).toBeVisible();

  const { settings } = await (await app.request.get('/api/status')).json();
  expect(settings).toMatchObject({
    targetTweetId: '9876543210',
    intervalMode: 'fixed_times',
    scheduleTimes: ['08:15', '20:45'],
    timezone: 'Asia/Tokyo',
  });
  expect(settings.template).toContain('{color_name}');

  // Survives a reload (server is the source of truth)
  await app.reload();
  await openTab(app, 'Timing');
  await expect(app.getByPlaceholder('Tweet ID or https://x.com/...')).toHaveValue('9876543210');
  await expect(app.getByPlaceholder('06:00, 18:00')).toHaveValue('08:15, 20:45');

  // Webhook URL is displayed; rotating requires confirmation and changes it
  const url = app.locator('input[readonly]');
  await expect(url).toHaveValue(/\/api\/cron\/trigger\?secret=/);
  const oldUrl = await url.inputValue();
  await app.getByRole('button', { name: 'Rotate Secret' }).click();
  await expect(app.getByRole('alertdialog')).toContainText('Rotate webhook secret?');
  await app.getByRole('button', { name: 'Cancel' }).click();
  await expect(url).toHaveValue(oldUrl);
  await app.getByRole('button', { name: 'Rotate Secret' }).click();
  await app.getByRole('alertdialog').getByRole('button', { name: 'Rotate' }).click();
  await expect(url).not.toHaveValue(oldUrl);
  await expect(url).toHaveValue(/\/api\/cron\/trigger\?secret=/);
});

test('credentials screen refuses to persist without CREDENTIALS_ENCRYPTION_KEY', async ({
  app,
}) => {
  await openApp(app);
  await openTab(app, 'API Keys');
  await expect(app.getByText(/CREDENTIALS_ENCRYPTION_KEY/).first()).toBeVisible();
  await expect(app.getByText(/Saving keys from this form is disabled/)).toBeVisible();
  await expect(app.getByRole('button', { name: 'Update OAuth 1.0a Keys' })).toBeDisabled();

  // The API itself refuses with a clear message and stores nothing
  const res = await app.request.post('/api/credentials', {
    data: { apiKey: 'k', apiSecret: 's', accessToken: 't', accessTokenSecret: 'ts' },
  });
  expect(res.status()).toBe(400);
  const body = await res.json();
  expect(body.success).toBe(false);
  expect(body.error).toMatch(/CREDENTIALS_ENCRYPTION_KEY/);
  const status = await (await app.request.get('/api/status')).json();
  expect(status.credentialsStatus.isFullyConfigured).toBe(false);
});
