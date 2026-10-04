/**
 * X ChromaBot - smoke tests
 * Every header tab renders, and the core navigation/toggle flows work end-to-end in a real browser.
 * Nothing here can reach X or Gemini: the server runs without keys and with global dry run + pause on.
 */

import { test, expect, openApp, openTab, TABS, type Tab } from './fixtures.js';

test('dashboard loads as the owner with dry-run and pause on', async ({ app }) => {
  await openApp(app);
  await expect(app.getByRole('button', { name: /Sign in with Google/ })).toHaveCount(0);
  await expect(app.getByRole('button', { name: /^Dry Run$/ })).toBeVisible();
  await expect(app.getByRole('button', { name: 'Paused' })).toBeVisible();
  await expect(app.getByRole('option', { name: 'Primary Eternal Colors' }).first()).toBeAttached();
  const status = await (await app.request.get('/api/status')).json();
  expect(status.settings.globalDryRun).toBe(true);
  expect(status.settings.globalPaused).toBe(true);
});

test('every header tab renders its screen', async ({ app }) => {
  await openApp(app);
  const headings: Record<Tab, RegExp> = {
    Studio: /Chromatic Post Studio/,
    Campaigns: /Tweet Contexts/,
    Queue: /Scheduled Drop Queue/,
    Logs: /Post Logs & History/,
    Timing: /Timing & Autonomous Reply Settings/,
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
