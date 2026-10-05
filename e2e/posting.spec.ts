/**
 * X ChromaBot - posting flows
 * Studio generate + preview + post, Queue send, and the History log. Everything must come back
 * simulated: the server has no X keys and global dry run is on.
 */

import { test, expect, openApp, openTab } from './fixtures.js';

interface Log {
  status?: string;
  tweetText?: string;
}
const logs = async (page: import('@playwright/test').Page): Promise<Log[]> =>
  (await (await page.request.get('/api/history')).json()).logs;

test('studio, queue and history: posts are simulated and the log can be cleared', async ({
  app,
}) => {
  await openApp(app);

  // Studio: the default (color) template offers the color re-roll; each one updates the preview
  await expect(app.getByText('X Live Reply Preview')).toBeVisible();
  const preview = app.getByTestId('tweet-preview-text');
  await expect(preview).not.toBeEmpty();
  for (const slot of ['Evening', 'Random', 'Morning']) {
    const before = await preview.innerText();
    await app.getByRole('button', { name: slot, exact: true }).click();
    await expect(preview).not.toHaveText(before);
  }
  await expect(app.getByText('Mode: Dry Run Simulation')).toBeVisible();

  // Studio: post -> simulated, with exactly the previewed text
  const previewed = await preview.innerText();
  await app.getByRole('button', { name: 'Simulate Post to X' }).click();
  await expect(app.getByText('Reply Simulated Successfully')).toBeVisible();
  expect((await logs(app))[0].tweetText).toBe(previewed);

  // Queue: send one slot -> simulated
  await openTab(app, 'Queue');
  await expect(app.getByText('Scheduled Drop Queue (14 Slots)')).toBeVisible();
  await expect(app.getByTitle('Send this post now')).toHaveCount(14);
  const firstSlotText = await app.getByTestId('queue-slot').first().locator('p').innerText();
  await app.getByTitle('Send this post now').first().click();
  await expect.poll(async () => (await logs(app)).length).toBe(2);
  expect((await logs(app))[0].tweetText).toBe(firstSlotText);
  await app.getByRole('button', { name: 'Re-roll' }).first().click();
  await app.getByRole('button', { name: /Clear & Regenerate Queue/ }).click();
  await expect(app.getByTitle('Send this post now')).toHaveCount(14);

  // History: both posts are listed as simulated, none went live
  await openTab(app, 'Logs');
  await expect(app.getByText('Simulated', { exact: true })).toHaveCount(2);
  await expect(app.getByTestId('history-tweet-text').filter({ hasText: previewed })).toHaveCount(1);
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
