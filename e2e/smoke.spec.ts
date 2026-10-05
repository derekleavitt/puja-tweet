/**
 * X ChromaBot - smoke tests
 * Every header tab renders, Campaigns is the main screen (there is no Studio and no "active
 * campaign" picker), and the global toggles work end-to-end in a real browser.
 * Nothing here can reach X or Gemini: the server runs without keys and with global dry run + pause on.
 */

import {
  test,
  expect,
  openApp,
  openTab,
  campaignCard,
  TABS,
  PRIMARY,
  type Tab,
} from './fixtures.js';

test('dashboard loads as the owner on the Campaigns screen with dry-run and pause on', async ({
  app,
}) => {
  await openApp(app);
  await expect(app.getByRole('button', { name: /Sign in with Google/ })).toHaveCount(0);
  await expect(app.getByRole('button', { name: /^Dry Run$/ })).toBeVisible();
  await expect(app.getByRole('button', { name: 'Paused' })).toBeVisible();
  await expect(app.getByText(/Tweet Contexts/).first()).toBeVisible();
  await expect(campaignCard(app, PRIMARY)).toBeVisible();
  const status = await (await app.request.get('/api/status')).json();
  expect(status.settings.globalDryRun).toBe(true);
  expect(status.settings.globalPaused).toBe(true);
});

test('there is no Studio tab and no active-campaign picker anywhere', async ({ app }) => {
  await openApp(app);
  await expect(app.getByRole('button', { name: 'Studio', exact: true })).toHaveCount(0);
  await expect(app.getByRole('button', { name: 'Timing', exact: true })).toHaveCount(0);
  await expect(app.getByText('Post Studio')).toHaveCount(0);
  await expect(app.getByText('Active in Studio')).toHaveCount(0);
  await expect(app.getByRole('button', { name: 'Set Active' })).toHaveCount(0);
  await expect(app.getByRole('button', { name: 'Trigger Drop' })).toHaveCount(0);
  // No campaign selector in the header or the status bar
  await expect(app.locator('header select')).toHaveCount(0);
  await expect(app.getByTestId('status-next-post')).toBeVisible();
  for (const tab of TABS) {
    await openTab(app, tab);
    await expect(app.getByText('Post Studio')).toHaveCount(0);
  }
  // The nav lists exactly the remaining screens
  const nav = app.locator('header nav').getByRole('button');
  await expect(nav).toHaveText([...TABS]);
});

test('every header tab renders its screen', async ({ app }) => {
  await openApp(app);
  const headings: Record<Tab, RegExp> = {
    Campaigns: /Tweet Contexts/,
    Queue: /Scheduled Drop Queue/,
    Logs: /Post Logs & History/,
    Settings: /^Global Settings$/,
    'API Keys': /Twitter \/ X Developer Account Integration/,
  };
  for (const tab of TABS) {
    await openTab(app, tab);
    await expect(app.getByText(headings[tab]).first()).toBeVisible();
  }
});

test('global dry-run and pause pills toggle and persist on the server', async ({ app }) => {
  await openApp(app);
  const settings = async () => (await (await app.request.get('/api/status')).json()).settings;

  await app.getByRole('button', { name: 'Paused' }).click();
  await expect(app.getByRole('button', { name: 'Running' })).toBeVisible();
  expect((await settings()).globalPaused).toBe(false);
  await app.getByRole('button', { name: 'Running' }).click();
  await expect(app.getByRole('button', { name: 'Paused' })).toBeVisible();
  expect((await settings()).globalPaused).toBe(true);

  // Dry run off then straight back on: nothing posts in between.
  await app.getByRole('button', { name: /^Dry Run$/ }).click();
  await expect(app.getByRole('button', { name: /^Live X API$/ })).toBeVisible();
  expect((await settings()).globalDryRun).toBe(false);
  await app.getByRole('button', { name: /^Live X API$/ }).click();
  await expect(app.getByRole('button', { name: /^Dry Run$/ })).toBeVisible();
  expect((await settings()).globalDryRun).toBe(true);
});
