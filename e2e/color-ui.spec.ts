/**
 * X ChromaBot - color UI only where it matters
 * A campaign whose template has no color token shows no color UI anywhere (its preview, Queue,
 * Logs), and posts its text verbatim. A color-token campaign's preview still shows the color
 * re-roll and posts the generated color in its text, exactly as previewed.
 */

import type { Locator, Page, Response } from '@playwright/test';
import { test, expect, openApp, openTab, openPreview, PRIMARY } from './fixtures.js';

const PLAIN = 'Shipping notes for the team #launch';
const PLAIN_NAME = 'Plain Campaign';
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

/** Nothing in `scope` paints a drop color (inline background), shows a hex or a re-roll. */
async function expectNoColorUi(scope: Locator) {
  await expect(scope.locator('[style*="background"]')).toHaveCount(0);
  await expect(scope.getByText(HEX)).toHaveCount(0);
  await expect(scope.getByText('Color:', { exact: true })).toHaveCount(0);
  for (const name of ['Morning', 'Evening', 'Random', 'Re-roll']) {
    await expect(scope.getByRole('button', { name, exact: true })).toHaveCount(0);
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
      data: { name: PLAIN_NAME, targetTweetId: '1700000000000000009', template: PLAIN },
    })
  ).json();
  const plainId: string = created.context.id;

  // Campaign card preview: the template text, no color controls or swatches
  await openApp(app);
  const plain = await openPreview(app, PLAIN_NAME);
  await expect(plain.getByTestId('tweet-preview-text')).toHaveText(PLAIN);
  await expectNoColorUi(plain);
  await plain.getByRole('button', { name: 'Post now (simulated)' }).click();
  await expect(plain.getByText('Reply Simulated Successfully')).toBeVisible();
  let [log] = await logs(app);
  expect(log).toMatchObject({ tweetText: PLAIN, status: 'simulated', contextId: plainId });

  // Queue (filtered to the plain campaign): its text and a Send action, no color tiles or re-roll
  await openTab(app, 'Queue');
  await app.getByLabel('Queue campaign').selectOption(plainId);
  await expect(app.getByTestId('queue-slot').first()).toContainText(PLAIN);
  await expectNoColorUi(app.locator('main'));
  await app.getByTitle('Send this post now').first().click();
  await expect.poll(async () => (await logs(app)).length).toBe(2);
  expect((await logs(app))[0].tweetText).toBe(PLAIN);

  // Logs: the posted text, no swatch column
  await openTab(app, 'Logs');
  await expect(app.getByTestId('history-tweet-text').first()).toHaveText(PLAIN);
  await expect(app.getByText('Color Swatch')).toHaveCount(0);
  await expectNoColorUi(app.locator('main'));

  // Color campaign: its preview has the re-roll and the generated color is in the posted text
  await openTab(app, 'Campaigns');
  const colored = await openPreview(app, PRIMARY);
  await expect(colored.getByText('Color:', { exact: true })).toBeVisible();
  const preview = colored.getByTestId('tweet-preview-text');
  const before = await preview.innerText();
  // Wait for the very response this click triggers.
  const [previewResponse] = await Promise.all([
    app.waitForResponse((r: Response) => r.url().endsWith('/api/template/preview')),
    colored.getByRole('button', { name: 'Evening', exact: true }).click(),
  ]);
  const color: { name: string; colorPick?: string } = (await previewResponse.json()).color;
  await expect(preview).not.toHaveText(before);
  await expect(preview).toContainText(color.colorPick || color.name);
  const previewed = await preview.innerText();
  await colored.getByRole('button', { name: 'Post now (simulated)' }).click();
  await expect(colored.getByText('Reply Simulated Successfully')).toBeVisible();
  [log] = await logs(app);
  expect(log.tweetText).toBe(previewed);
  expect(log.tweetText).toContain(log.color!.colorPick || log.color!.name);
  expect(log.contextId).toBe(primaryId);

  // Queue for the color campaign keeps its re-roll
  await openTab(app, 'Queue');
  await app.getByLabel('Queue campaign').selectOption(primaryId);
  await expect(app.getByRole('button', { name: 'Re-roll', exact: true })).toHaveCount(14);
});

// Clean up (also after a failure) so other specs see the default campaign only.
test.afterEach(async ({ request }) => {
  const { contexts } = await (await request.get('/api/status')).json();
  for (const c of contexts as { id: string; name: string }[]) {
    if (c.name === PLAIN_NAME) await request.delete(`/api/contexts/${c.id}`);
  }
  await request.delete('/api/history');
});
