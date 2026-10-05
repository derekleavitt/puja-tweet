/**
 * X ChromaBot - evolving hashtags
 * Enable evolution on the primary campaign, see evolved tags in the Studio preview, post
 * (simulated) and watch the campaign card's "Current hashtags" update. No Gemini key is set, so
 * the offline generator runs.
 */

import type { Response } from '@playwright/test';
import { test, expect, openApp, openTab } from './fixtures.js';

interface Preview {
  previewText: string;
  hashtags?: string[];
}

test('evolving hashtags: preview shows new tags, the post matches, the card shows them', async ({
  app,
}) => {
  await app.request.delete('/api/history');
  const previews: Preview[] = [];
  app.on('response', async (r: Response) => {
    if (r.url().endsWith('/api/template/preview')) previews.push(await r.json());
  });

  await openApp(app);
  await openTab(app, 'Campaigns');
  await expect(app.getByTestId('current-hashtags')).toHaveCount(0); // off by default

  // Enable evolution in the campaign form; it shows the seed tags found in the template.
  await app.getByTitle('Edit context & schedule').first().click();
  await app.getByLabel(/Evolve hashtags each tweet/).check();
  await expect(app.getByText('Seed tags detected in your template:')).toBeVisible();
  await expect(app.locator('form').getByText('#eternal', { exact: true })).toBeVisible();
  await app.getByLabel('Max tags', { exact: true }).selectOption('2');
  await app.getByRole('button', { name: 'Save & Regenerate Queue' }).click();
  await expect(app.getByRole('button', { name: 'Save & Regenerate Queue' })).toHaveCount(0);
  await expect(app.getByTestId('current-hashtags')).toContainText('none yet');

  // Studio preview shows evolved tags instead of the template's #eternal #colors.
  await openTab(app, 'Studio');
  await expect(app.getByText('Evolving hashtags')).toBeVisible();
  await expect.poll(() => previews.length).toBeGreaterThan(0);
  await expect(app.getByRole('button', { name: 'Simulate Post to X' })).toBeEnabled();
  const shown = () => previews.at(-1)!;
  await expect(app.locator('main')).toContainText(shown().previewText);
  expect(shown().hashtags!.length).toBeGreaterThan(0);
  expect(shown().previewText).not.toMatch(/#eternal|#colors/i);

  // Post (simulated): exactly the previewed text goes out.
  const previewed = shown();
  await app.getByRole('button', { name: 'Simulate Post to X' }).click();
  await expect(app.getByText('Reply Simulated Successfully')).toBeVisible();
  const { logs } = await (await app.request.get('/api/history')).json();
  expect(logs[0].tweetText).toBe(previewed.previewText);
  expect(logs[0].status).toBe('simulated');

  // The card now lists those tags as the current hashtags.
  await openTab(app, 'Campaigns');
  for (const tag of previewed.hashtags!) {
    await expect(app.getByTestId('current-hashtags')).toContainText(`#${tag}`);
  }

  // Clean up so other specs see the default campaign.
  const { contexts } = await (await app.request.get('/api/status')).json();
  await app.request.put(`/api/contexts/${contexts[0].id}`, {
    data: { hashtagEvolution: { enabled: false } },
  });
  await app.request.delete('/api/history');
});
