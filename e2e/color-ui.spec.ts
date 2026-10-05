/**
 * X ChromaBot - color UI only where it matters
 * A campaign whose template has no color token shows no color UI anywhere (Studio, Queue, Logs),
 * and posts its text verbatim. A color-token campaign still shows the color re-roll and posts the
 * generated color in its text, exactly as previewed.
 */

import type { Page, Response } from '@playwright/test';
import { test, expect, openApp, openTab } from './fixtures.js';

const PLAIN = 'Shipping notes for the team #launch';
/** A hex color code, not a (possibly truncated) tweet id like #1700000000… */
const HEX = /#[0-9A-F]{6}(?![0-9A-F…])/i;

interface Log {
  tweetText: string;
  status: string;
  contextId?: string;
  color?: { name: string; colorPick?: string; hex: string };
}
const logs = async (page: Page): Promise<Log[]> =>
  (await (await page.request.get('/api/history')).json()).logs;

/** Nothing in the main area paints a drop color (inline background), shows a hex or a re-roll. */
async function expectNoColorUi(page: Page) {
  const main = page.locator('main');
  await expect(main.locator('[style*="background"]')).toHaveCount(0);
  await expect(main.getByText(HEX)).toHaveCount(0);
  await expect(main.getByText('Color:', { exact: true })).toHaveCount(0);
  for (const name of ['Morning', 'Evening', 'Random', 'Re-roll']) {
    await expect(main.getByRole('button', { name, exact: true })).toHaveCount(0);
  }
}

test('non-color campaign shows no color UI; color campaign still posts its color', async ({
  app,
}) => {
  await app.request.delete('/api/history');
  const status = await (await app.request.get('/api/status')).json();
  const primaryId: string = status.contexts[0].id;
  const created = await (
    await app.request.post('/api/contexts', {
      data: { name: 'Plain Campaign', targetTweetId: '1700000000000000009', template: PLAIN },
    })
  ).json();
  const plainId: string = created.context.id;
  await app.request.post(`/api/contexts/${plainId}/activate`);

  // Studio: the preview is the template text, no color controls or swatches
  await openApp(app);
  await expect(app.getByTestId('tweet-preview-text')).toHaveText(PLAIN);
  await expectNoColorUi(app);
  await app.getByRole('button', { name: 'Simulate Post to X' }).click();
  await expect(app.getByText('Reply Simulated Successfully')).toBeVisible();
  let [log] = await logs(app);
  expect(log).toMatchObject({ tweetText: PLAIN, status: 'simulated', contextId: plainId });

  // Queue: upcoming posts with their text and a Send action, no color tiles or re-roll
  await openTab(app, 'Queue');
  await expect(app.getByTestId('queue-slot').first()).toContainText(PLAIN);
  await expectNoColorUi(app);
  await app.getByTitle('Send this post now').first().click();
  await expect.poll(async () => (await logs(app)).length).toBe(2);
  expect((await logs(app))[0].tweetText).toBe(PLAIN);

  // Logs: the posted text, no swatch column
  await openTab(app, 'Logs');
  await expect(app.getByTestId('history-tweet-text').first()).toHaveText(PLAIN);
  await expect(app.getByText('Color Swatch')).toHaveCount(0);
  await expectNoColorUi(app);

  // Color campaign: the re-roll is back and the generated color is in the posted text
  const colors: { name: string; colorPick?: string }[] = [];
  app.on('response', async (r: Response) => {
    if (r.url().endsWith('/api/generate-color')) colors.push((await r.json()).color);
  });
  await openTab(app, 'Studio');
  await app.locator('header select').selectOption(primaryId);
  await expect(app.getByText('Color:', { exact: true })).toBeVisible();
  const preview = app.getByTestId('tweet-preview-text');
  const before = await preview.innerText();
  await app.getByRole('button', { name: 'Evening', exact: true }).click();
  await expect(preview).not.toHaveText(before);
  const color = colors.at(-1)!;
  await expect(preview).toContainText(color.colorPick || color.name);
  const previewed = await preview.innerText();
  await app.getByRole('button', { name: 'Simulate Post to X' }).click();
  await expect(app.getByText('Reply Simulated Successfully')).toBeVisible();
  [log] = await logs(app);
  expect(log.tweetText).toBe(previewed);
  expect(log.tweetText).toContain(log.color!.colorPick || log.color!.name);
  expect(log.contextId).toBe(primaryId);

  // Queue for the color campaign keeps its re-roll
  await openTab(app, 'Queue');
  await expect(app.getByRole('button', { name: 'Re-roll', exact: true })).toHaveCount(14);
});

// Clean up (also after a failure) so other specs see the default campaign only.
test.afterEach(async ({ request }) => {
  const { contexts } = await (await request.get('/api/status')).json();
  for (const c of contexts as { id: string; name: string }[]) {
    if (c.name === 'Plain Campaign') await request.delete(`/api/contexts/${c.id}`);
  }
  await request.post(`/api/contexts/${contexts[0].id}/activate`);
  await request.delete('/api/history');
});
