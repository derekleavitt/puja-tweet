/**
 * X ChromaBot - evolving hashtags
 * Enable evolution in the primary campaign's form, see the evolved tags in its card preview, post
 * (simulated) exactly that text + those tags, and watch the card's "Current hashtags" update.
 * No Gemini key is set, so the offline generator runs.
 */

import type { Request, Response } from '@playwright/test';
import { test, expect, openApp, campaignCard, PRIMARY } from './fixtures.js';

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
  const card = campaignCard(app, PRIMARY);
  await expect(app.getByTestId('current-hashtags')).toHaveCount(0); // off by default

  // Enable evolution in the campaign form; it shows the seed tags found in the template.
  await card.getByTitle('Edit context & schedule').click();
  await app.getByLabel(/Evolve hashtags each tweet/).check();
  await expect(app.getByText('Seed tags detected in your template:')).toBeVisible();
  await expect(app.locator('form').getByText('#eternal', { exact: true })).toBeVisible();
  await app.getByLabel('Max tags', { exact: true }).selectOption('2');
  await app.getByRole('button', { name: 'Save & Regenerate Queue' }).click();
  await expect(app.getByRole('button', { name: 'Save & Regenerate Queue' })).toHaveCount(0);
  await expect(card.getByTestId('current-hashtags')).toContainText('none yet');

  // The card preview shows evolved tags instead of the template's #eternal #colors.
  await card.getByRole('button', { name: 'Preview & post' }).click();
  const panel = card.getByTestId('campaign-preview');
  await expect(panel.getByText('Evolving hashtags')).toBeVisible();
  await expect.poll(() => previews.length).toBeGreaterThan(0);
  const post = panel.getByRole('button', { name: 'Post now (simulated)' });
  await expect(post).toBeEnabled();
  const shown = () => previews.at(-1)!;
  await expect(panel.getByTestId('tweet-preview-text')).toHaveText(shown().previewText);
  expect(shown().hashtags!.length).toBeGreaterThan(0);
  expect(shown().previewText).not.toMatch(/#eternal|#colors/i);
  for (const tag of shown().hashtags!) {
    await expect(panel.getByTestId('preview-hashtags')).toContainText(`#${tag}`);
  }

  // Post (simulated): exactly the previewed text, with the hashtags it used (BUG-3 contract).
  const previewed = shown();
  const [request] = await Promise.all([
    app.waitForRequest((r: Request) => r.url().endsWith('/api/post-now')),
    post.click(),
  ]);
  expect(request.postDataJSON()).toMatchObject({
    text: previewed.previewText,
    hashtags: previewed.hashtags,
  });
  await expect(panel.getByText('Reply Simulated Successfully')).toBeVisible();
  const { logs } = await (await app.request.get('/api/history')).json();
  expect(logs[0].tweetText).toBe(previewed.previewText);
  expect(logs[0].status).toBe('simulated');

  // The card now lists those tags as the current hashtags.
  for (const tag of previewed.hashtags!) {
    await expect(card.getByTestId('current-hashtags')).toContainText(`#${tag}`);
  }

  // Clean up so other specs see the default campaign.
  const { contexts } = await (await app.request.get('/api/status')).json();
  await app.request.put(`/api/contexts/${contexts[0].id}`, {
    data: { hashtagEvolution: { enabled: false } },
  });
  await app.request.delete('/api/history');
});
