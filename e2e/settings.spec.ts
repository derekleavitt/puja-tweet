/**
 * X ChromaBot - settings and credentials flows
 */

import { test, expect, openApp, openTab, campaignCard, PRIMARY } from './fixtures.js';

test('settings hold only global things; the webhook secret rotates behind a confirm', async ({
  app,
}) => {
  await openApp(app);
  await openTab(app, 'Settings');

  // Global only: no per-campaign target / schedule / template / campaign switches here
  await expect(app.getByRole('region', { name: 'All campaigns' })).toBeVisible();
  await expect(app.getByRole('region', { name: 'This campaign' })).toHaveCount(0);
  await expect(app.getByRole('region', { name: 'Rate limits' })).toContainText('X quota');
  await expect(app.locator('main textarea')).toHaveCount(0);
  await expect(app.getByPlaceholder(/Tweet ID or https/)).toHaveCount(0);
  await expect(app.getByPlaceholder('06:00, 18:00')).toHaveCount(0);
  await expect(app.getByRole('button', { name: 'Save Settings' })).toHaveCount(0);

  // Rate limits open the telemetry modal
  await app.getByRole('button', { name: 'Open rate limits' }).click();
  await expect(app.getByText('X API Rate Limits & Quota Telemetry')).toBeVisible();
  await app.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(app.getByText('X API Rate Limits & Quota Telemetry')).toHaveCount(0);

  // Webhook URL is displayed; rotating requires confirmation and changes it
  const url = app.locator('main input[readonly]');
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

  // Each campaign's own pinned URL (in its form) uses the rotated secret
  const secret = new URL(await url.inputValue()).searchParams.get('secret')!;
  await openTab(app, 'Campaigns');
  await campaignCard(app, PRIMARY).getByTitle('Edit context & schedule').click();
  const pinned = app.getByLabel('Campaign webhook URL');
  await expect(pinned).toHaveValue(/contextId=/);
  expect(new URL(await pinned.inputValue()).searchParams.get('secret')).toBe(secret);
  await app.getByRole('button', { name: 'Cancel' }).click();
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
