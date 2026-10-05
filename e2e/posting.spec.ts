/**
 * X ChromaBot - posting flows
 * Campaign card preview + post, Queue send, and the History log. Everything must come back
 * simulated: the server has no X keys and global dry run is on.
 */

import type { Request } from '@playwright/test';
import { test, expect, openApp, openTab, openPreview, campaignCard, PRIMARY } from './fixtures.js';

interface Log {
  status?: string;
  tweetText?: string;
  contextId?: string;
}
const logs = async (page: import('@playwright/test').Page): Promise<Log[]> =>
  (await (await page.request.get('/api/history')).json()).logs;

test('campaign preview, queue and history: posts are simulated and the log can be cleared', async ({
  app,
}) => {
  await app.request.delete('/api/history');
  await openApp(app);

  // Campaign card: the default (color) template offers the color re-roll; each updates the preview
  const panel = await openPreview(app, PRIMARY);
  const preview = panel.getByTestId('tweet-preview-text');
  await expect(preview).not.toBeEmpty();
  for (const slot of ['Evening', 'Random', 'Morning']) {
    const before = await preview.innerText();
    await panel.getByRole('button', { name: slot, exact: true }).click();
    await expect(preview).not.toHaveText(before);
  }
  await expect(panel.getByText('Dry run is on, so nothing is sent to X.')).toBeVisible();

  // Post now -> simulated, with exactly the previewed text (sent verbatim as `text`)
  const previewed = await preview.innerText();
  const [request] = await Promise.all([
    app.waitForRequest((r: Request) => r.url().endsWith('/api/post-now')),
    panel.getByRole('button', { name: 'Post now (simulated)' }).click(),
  ]);
  expect(request.postDataJSON().text).toBe(previewed);
  await expect(panel.getByText('Reply Simulated Successfully')).toBeVisible();
  const [first] = await logs(app);
  expect(first.tweetText).toBe(previewed);
  expect(first.status).toBe('simulated');

  // Queue: send one slot -> simulated
  await openTab(app, 'Queue');
  await expect(app.getByText('Scheduled Drop Queue (14 Slots)')).toBeVisible();
  await expect(app.getByTitle('Send this post now')).toHaveCount(14);
  const firstSlotText = await app.getByTestId('queue-slot-text').first().innerText();
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

test('a campaign card has one manual-post action, and a live post asks first', async ({ app }) => {
  await app.request.delete('/api/history');
  await openApp(app);
  const card = campaignCard(app, PRIMARY);
  await expect(card.getByRole('button', { name: 'Trigger Drop' })).toHaveCount(0);
  await expect(card.getByRole('button', { name: /Post now/ })).toHaveCount(0); // only in the preview

  // Global dry run off + campaign live: the post would be live, so it asks; cancel posts nothing.
  await app.getByRole('button', { name: /^Dry Run$/ }).click();
  await expect(app.getByRole('button', { name: /^Live X API$/ })).toBeVisible();
  try {
    await expect(card.getByRole('button', { name: 'Campaign dry run: off' })).toBeVisible();
    const panel = await openPreview(app, PRIMARY);
    await panel.getByRole('button', { name: 'Post now (live)' }).click();
    const dialog = app.getByRole('alertdialog');
    await expect(dialog).toContainText(`Campaign "${PRIMARY}" will post a real tweet`);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(panel.getByRole('button', { name: 'Post now (live)' })).toBeEnabled();
    expect(await logs(app)).toHaveLength(0);
  } finally {
    await app.getByRole('button', { name: /^Live X API$/ }).click();
    await expect(app.getByRole('button', { name: /^Dry Run$/ })).toBeVisible();
  }
});
