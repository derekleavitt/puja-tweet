/**
 * X ChromaBot - X accounts (multi-account posting)
 * The e2e server has no X keys, so connecting cannot reach X: the account routes are mocked with
 * page.route (the real server still serves everything else). Status and campaign saves pass
 * through the real server with the mocked account folded in.
 */

import type { Page, Route } from '@playwright/test';
import { test, expect, openApp, openTab, campaignCard, PRIMARY } from './fixtures.js';

interface MockAccount {
  id: string;
  label: string;
  handle: string;
  userId: string;
  status: 'ok' | 'revoked' | 'unverified';
  createdAt: string;
  lastVerifiedAt?: string;
  isDefault: false;
}

/** A fake account layer over the real API. */
async function mockAccounts(page: Page) {
  const accounts: MockAccount[] = [];
  /** Campaign id -> mocked account id (the real server only knows the default account). */
  const campaignAccount = new Map<string, string>();
  const isMock = (id: unknown) => accounts.some((a) => a.id === id);
  const withMock = <T extends { id: string; accountId?: string }>(c: T): T =>
    campaignAccount.has(c.id) ? { ...c, accountId: campaignAccount.get(c.id) } : c;

  const add = (userId: string, handle: string) => {
    const account: MockAccount = {
      id: `acct_${userId}`,
      label: `@${handle}`,
      handle,
      userId,
      status: 'ok',
      createdAt: new Date().toISOString(),
      lastVerifiedAt: new Date().toISOString(),
      isDefault: false,
    };
    accounts.push(account);
    return account;
  };

  await page.route('**/api/status', async (route) => {
    const res = await route.fetch();
    const json = await res.json();
    json.accounts = [...(json.accounts ?? []), ...accounts];
    json.contexts = (json.contexts ?? []).map(withMock);
    await route.fulfill({ response: res, json });
  });

  await page.route('**/api/accounts/connect/start', (route) =>
    route.fulfill({
      json: {
        success: true,
        mode: 'pin',
        oauthToken: 'tok-pin',
        authorizeUrl: 'https://api.x.com/oauth/authorize?oauth_token=tok-pin&force_login=true',
      },
    }),
  );

  await page.route('**/api/accounts/connect/complete', async (route) => {
    const body = route.request().postDataJSON() as { oauthToken: string; verifier: string };
    const account =
      body.oauthToken === 'tok-pin' ? add('777', 'brand_e2e') : add('888', 'redirect_e2e');
    await route.fulfill({ json: { success: true, account, accounts } });
  });

  await page.route(/\/api\/accounts\/acct_\d+$/, async (route: Route) => {
    const id = new URL(route.request().url()).pathname.split('/').pop()!;
    const account = accounts.find((a) => a.id === id);
    if (!account) return route.fulfill({ status: 404, json: { error: 'not found' } });
    if (route.request().method() === 'PATCH') {
      account.label = (route.request().postDataJSON() as { label: string }).label;
      return route.fulfill({ json: { success: true, account, accounts } });
    }
    accounts.splice(accounts.indexOf(account), 1);
    const paused = [...campaignAccount].filter(([, a]) => a === id).map(([c]) => c);
    return route.fulfill({ json: { success: true, pausedCampaigns: paused, accounts } });
  });

  // Campaign saves: the real server validates accounts, so the mocked id is kept on this side.
  await page.route(/\/api\/contexts\/[^/]+$/, async (route) => {
    if (route.request().method() !== 'PUT') return route.fallback();
    const id = new URL(route.request().url()).pathname.split('/').pop()!;
    const body = route.request().postDataJSON() as { accountId?: string };
    if (isMock(body.accountId)) campaignAccount.set(id, body.accountId!);
    else if ('accountId' in body) campaignAccount.delete(id);
    if (isMock(body.accountId) || campaignAccount.has(id)) delete body.accountId;
    const res = await route.fetch({ postData: JSON.stringify(body) });
    const json = await res.json();
    if (json.context) json.context = withMock(json.context);
    if (json.contexts) json.contexts = json.contexts.map(withMock);
    await route.fulfill({ response: res, json });
  });

  return { accounts };
}

const accountsSection = (page: Page) => page.getByRole('region', { name: 'X accounts' });
const row = (page: Page, handle: string) =>
  accountsSection(page)
    .getByTestId('account-row')
    .filter({ hasText: `@${handle}` });

test('settings list the default account; the campaign form shows "Posts as" and keeps it', async ({
  app,
}) => {
  await openApp(app);
  await openTab(app, 'Settings');
  const section = accountsSection(app);
  await expect(section).toContainText('/oauth/x/callback');
  const defaultRow = section.locator('[data-account-id="acct_env"]');
  await expect(defaultRow).toContainText('Default account');
  await expect(defaultRow.getByRole('button', { name: 'Verify' })).toBeVisible();
  await expect(defaultRow.getByRole('button', { name: 'Rename' })).toHaveCount(0);
  await expect(defaultRow.getByRole('button', { name: 'Remove' })).toHaveCount(0);

  await openTab(app, 'Campaigns');
  await expect(campaignCard(app, PRIMARY).getByTestId('posts-as')).toContainText(
    'Posts as the default account',
  );
  await campaignCard(app, PRIMARY).getByTitle('Edit context & schedule').click();
  const postsAs = app.getByLabel('Posts as');
  await expect(postsAs).toHaveValue('acct_env');
  await expect(app.getByText(/X only allows replies to posts this account wrote/)).toBeVisible();
  await app.getByRole('button', { name: 'Save & Regenerate Queue' }).click();
  await expect(postsAs).toHaveCount(0);
  await campaignCard(app, PRIMARY).getByTitle('Edit context & schedule').click();
  await expect(app.getByLabel('Posts as')).toHaveValue('acct_env');
  await app.getByRole('button', { name: 'Cancel' }).click();
});

test('connect (PIN), rename, assign to a campaign, and remove an account', async ({ app }) => {
  await mockAccounts(app);
  await openApp(app);
  await openTab(app, 'Settings');

  // Connect with a PIN
  await app.getByRole('button', { name: 'Use a PIN instead' }).click();
  const link = app.getByRole('link', { name: /Open X to authorize/ });
  await expect(link).toHaveAttribute(
    'href',
    /oauth\/authorize\?oauth_token=tok-pin&force_login=true/,
  );
  await app.getByLabel('PIN from X').fill('1234567');
  await app.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(row(app, 'brand_e2e')).toBeVisible();
  await expect(row(app, 'brand_e2e')).toContainText('OK');

  // Rename
  await row(app, 'brand_e2e').getByRole('button', { name: 'Rename' }).click();
  await app.getByLabel('Account label').fill('Brand');
  await app.getByLabel('Account label').press('Enter');
  await expect(row(app, 'brand_e2e')).toContainText('· Brand');

  // Assign it to a campaign: the value is saved and the card names the account
  await openTab(app, 'Campaigns');
  await campaignCard(app, PRIMARY).getByTitle('Edit context & schedule').click();
  await app.getByLabel('Posts as').selectOption('acct_777');
  await app.getByRole('button', { name: 'Save & Regenerate Queue' }).click();
  await expect(campaignCard(app, PRIMARY).getByTestId('posts-as')).toContainText(
    'Posts as @brand_e2e',
  );
  await campaignCard(app, PRIMARY).getByTitle('Edit context & schedule').click();
  await expect(app.getByLabel('Posts as')).toHaveValue('acct_777');
  await app.getByRole('button', { name: 'Cancel' }).click();

  // Remove: the confirmation lists the campaign that will pause
  await openTab(app, 'Settings');
  await row(app, 'brand_e2e').getByRole('button', { name: 'Remove' }).click();
  const dialog = app.getByRole('alertdialog');
  await expect(dialog).toContainText('Remove @brand_e2e?');
  await expect(dialog).toContainText(PRIMARY);
  await dialog.getByRole('button', { name: 'Remove' }).click();
  await expect(row(app, 'brand_e2e')).toHaveCount(0);
  await openTab(app, 'Campaigns');
  await expect(campaignCard(app, PRIMARY).getByTestId('posts-as')).toContainText(
    'pick another account',
  );
});

test('the /oauth/x/callback redirect finishes the connection and opens Settings', async ({
  app,
}) => {
  await mockAccounts(app);
  await app.goto('/oauth/x/callback?oauth_token=tok-redirect&oauth_verifier=v-123');
  await expect(row(app, 'redirect_e2e')).toBeVisible();
  await expect(app.getByText('Connected @redirect_e2e')).toBeVisible();
  expect(new URL(app.url()).pathname).toBe('/');
  expect(app.url()).not.toContain('oauth_verifier');
});
