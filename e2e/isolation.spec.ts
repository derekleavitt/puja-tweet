/**
 * X ChromaBot - campaign isolation through the UI
 * The Timing (Settings) form edits the campaign it was opened for, even when the active campaign
 * is switched elsewhere (another tab / API) before Save; a new campaign never inherits the active
 * campaign's target.
 */

import { test, expect, openApp, openTab } from './fixtures.js';

const SERVER_DEFAULT_TARGET = '1700000000000000001';
const B_TARGET = '2000000000000000002';

interface Ctx {
  id: string;
  name: string;
  targetTweetId: string;
  template: string;
}
const contexts = async (page: import('@playwright/test').Page): Promise<Ctx[]> =>
  (await (await page.request.get('/api/contexts')).json()).contexts;

test('saving the Timing form edits only the campaign it was opened for', async ({ app }) => {
  // A second campaign, made active through the API (as the header switcher would)
  const created = await (
    await app.request.post('/api/contexts', {
      data: { name: 'Campaign B', targetTweetId: B_TARGET, template: 'B {hex}', enabled: false },
    })
  ).json();
  const B: string = created.context.id;
  await app.request.post(`/api/contexts/${B}/activate`);

  await openApp(app);
  await openTab(app, 'Timing');
  await expect(app.getByText(/This campaign: Campaign B/)).toBeVisible();
  await expect(app.getByPlaceholder('Tweet ID or https://x.com/...')).toHaveValue(B_TARGET);

  // Meanwhile the active campaign is switched back to the primary one (other tab / API)
  const primary = (await contexts(app)).find((c) => c.id !== B)!;
  await app.request.post(`/api/contexts/${primary.id}/activate`);

  // The open form still belongs to B: Save must edit B, never the (now active) primary campaign
  await app.locator('form textarea').first().fill('B edited {color_pick}');
  await app.getByRole('button', { name: 'Save Settings' }).click();
  await expect
    .poll(async () => (await contexts(app)).find((c) => c.id === B)!.template)
    .toBe('B edited {color_pick}');
  const after = await contexts(app);
  expect(after.find((c) => c.id === primary.id)!.template).toBe(primary.template);
  expect(after.find((c) => c.id === primary.id)!.targetTweetId).toBe(primary.targetTweetId);

  // After the save the form follows the real active campaign again (the primary one)
  await expect(app.getByText(/This campaign: Primary Eternal Colors/)).toBeVisible();
  await expect(app.locator('form textarea').first()).toHaveValue(primary.template);
});

test("the new-campaign form never prefills the active campaign's target", async ({ app }) => {
  await openApp(app);
  await openTab(app, 'Timing');
  await app.getByPlaceholder('Tweet ID or https://x.com/...').fill('1234567890123456789');
  await app.getByRole('button', { name: 'Save Settings' }).click();
  await expect(app.getByText('Settings Saved')).toBeVisible();

  await openTab(app, 'Campaigns');
  await app.getByRole('button', { name: /Add Tweet Context/ }).click();
  await expect(app.getByPlaceholder(/Tweet ID or https/)).toHaveValue(SERVER_DEFAULT_TARGET);
});
