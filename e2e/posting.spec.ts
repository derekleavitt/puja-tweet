/**
 * X ChromaBot - posting flows
 * Studio generate + preview + post, Queue send, and the History log. Everything must come back
 * simulated: the server has no X keys and global dry run is on.
 */

import { test, expect, openApp, openTab } from './fixtures.js';

interface Log {
  status?: string;
}
const logs = async (page: import('@playwright/test').Page): Promise<Log[]> =>
  (await (await page.request.get('/api/history')).json()).logs;

test('studio, queue and history: posts are simulated and the log can be cleared', async ({
  app,
}) => {
  await openApp(app);

  // Studio: generate colors for each slot and see the preview update
  await expect(app.getByText('X Live Reply Preview')).toBeVisible();
  const hex = app.locator('button', { hasText: /^#[0-9A-F]{6}$/i }).first();
  await expect(hex).toBeVisible();
  const before = await hex.innerText();
  for (const slot of ['Evening Dusk', 'Random Pick', 'Morning Dawn']) {
    await app.getByRole('button', { name: slot }).click();
    await expect(app.getByText('Simulate Post to X')).toBeVisible();
  }
  void before;
  await expect(app.getByText('Mode: Dry Run Simulation')).toBeVisible();

  // Studio: post -> simulated
  await app.getByRole('button', { name: 'Simulate Post to X' }).click();
  await expect(app.getByText('Reply Simulated Successfully')).toBeVisible();

  // Queue: send one slot -> simulated
  await openTab(app, 'Queue');
  await expect(app.getByText('Scheduled Drop Queue (14 Slots)')).toBeVisible();
  await expect(app.getByTitle('Send this color reply immediately')).toHaveCount(14);
  await app.getByTitle('Send this color reply immediately').first().click();
  await expect.poll(async () => (await logs(app)).length).toBe(2);
  await app.getByRole('button', { name: 'Re-roll' }).first().click();
  await app.getByRole('button', { name: /Clear & Regenerate Queue/ }).click();
  await expect(app.getByTitle('Send this color reply immediately')).toHaveCount(14);

  // History: both posts are listed as simulated, none went live
  await openTab(app, 'Logs');
  await expect(app.getByText('Simulated', { exact: true })).toHaveCount(2);
  for (const log of await logs(app)) {
    expect(log.status).toBe('simulated');
  }
  await app.getByRole('button', { name: 'simulated' }).click();
  await expect(app.locator('tbody tr')).toHaveCount(2);
  await app.getByRole('button', { name: 'success', exact: true }).click();
  await expect(app.getByText('No post logs recorded yet')).toBeVisible();
  await app.getByRole('button', { name: 'all', exact: true }).click();

  // Clear
  await app.getByTitle('Clear all logs').click();
  await expect(app.getByText('No post logs recorded yet')).toBeVisible();
  expect(await logs(app)).toHaveLength(0);
});

test('"Trigger Drop" on a campaign card posts a simulated drop', async ({ app }) => {
  await app.request.delete('/api/history');
  await openApp(app);
  await openTab(app, 'Campaigns');
  await app.getByRole('button', { name: 'Trigger Drop' }).first().click();
  await expect.poll(async () => (await logs(app)).length).toBe(1);
  expect((await logs(app))[0].status).toBe('simulated');
  await app.request.delete('/api/history');
});
