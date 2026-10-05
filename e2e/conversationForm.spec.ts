/**
 * X ChromaBot - conversation campaign form
 * Mode switch, participant rows, first-speaker options, turn length and the saved request body.
 * The accounts are mocked on /api/status and the create call is intercepted, so no real X account
 * or server-side conversation support is needed.
 */

import type { Page } from '@playwright/test';
import { test, expect, openApp } from './fixtures.js';

const HANDLES = ['main_e2e', 'alice', 'bob', 'carol', 'dan', 'erin'];
const ids = ['acct_env', ...HANDLES.slice(1).map((h, i) => `acct_${i + 1}00`)];

/** Six verified accounts (the default plus five connected ones) in the status response. */
async function mockAccounts(page: Page) {
  await page.route('**/api/status', async (route) => {
    const res = await route.fetch();
    const json = await res.json();
    json.accounts = HANDLES.map((handle, i) => ({
      id: ids[i],
      label: `@${handle}`,
      handle,
      userId: String(i),
      status: 'ok',
      createdAt: new Date().toISOString(),
      isDefault: i === 0,
    }));
    await route.fulfill({ response: res, json });
  });
}

/** Captures the body of the create call and answers it without touching the real server. */
async function captureCreate(page: Page) {
  const bodies: Record<string, unknown>[] = [];
  await page.route('**/api/contexts', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    bodies.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({ json: { success: true } });
  });
  return bodies;
}

async function openConversationForm(page: Page) {
  await openApp(page);
  await page.getByRole('button', { name: /Add Tweet Context/ }).click();
  await page.getByRole('radio', { name: 'Conversation' }).click();
}

const rowsOf = (page: Page) => page.getByTestId('participant-row');
const account = (page: Page, n: number) => page.getByLabel(`Participant ${n} account`);

test('conversation mode hides the single-account fields and relabels the target', async ({
  app,
}) => {
  await mockAccounts(app);
  await openApp(app);
  await app.getByRole('button', { name: /Add Tweet Context/ }).click();
  await expect(app.getByLabel('Posts as')).toBeVisible();
  await expect(app.getByText('Theme Preference')).toBeVisible();
  await expect(app.getByText('Target Tweet ID or URL *')).toBeVisible();

  await app.getByRole('radio', { name: 'Conversation' }).click();
  for (const hidden of [
    app.getByLabel('Posts as'),
    app.getByText('Reply Threading Strategy'),
    app.getByText('Engagement Mode on X'),
    app.getByText('Fall back to a Quote Tweet'),
    app.getByText('Theme Preference'),
    app.getByText('Max tags'),
    app.getByText('Target Tweet ID or URL *'),
  ]) {
    await expect(hidden).toHaveCount(0);
  }
  await expect(app.getByText('Opening reply (tweet ID/URL) *')).toBeVisible();
  await expect(
    app.getByText('Post the first reply yourself, @mentioning the accounts, then paste it here.'),
  ).toBeVisible();
  await expect(app.getByLabel('Posting Mode')).toBeVisible();

  // Two rows prefilled with the first two accounts; the 2-voice hint shows
  await expect(rowsOf(app)).toHaveCount(2);
  await expect(account(app, 1)).toHaveValue('acct_env');
  await expect(account(app, 2)).toHaveValue('acct_100');
  await expect(app.getByText('With two voices they simply take turns.')).toBeVisible();

  // Back to a single account: everything returns
  await app.getByRole('radio', { name: 'Single account' }).click();
  await expect(app.getByLabel('Posts as')).toBeVisible();
  await expect(app.getByText('Participants (')).toHaveCount(0);
});

test('participant rows: max 5, min 2, no account twice', async ({ app }) => {
  await mockAccounts(app);
  await openConversationForm(app);
  const add = app.getByRole('button', { name: 'Add participant' });
  await expect(app.getByRole('button', { name: 'Remove participant 1' })).toBeDisabled();

  await add.click();
  await expect(app.getByText('With two voices they simply take turns.')).toHaveCount(0);
  await add.click();
  await add.click();
  await expect(rowsOf(app)).toHaveCount(5);
  await expect(add).toBeDisabled();

  // An account chosen in another row is not offered; a new row asks for a pick
  await expect(app.getByText('Pick an account for participant 3.')).toBeVisible();
  await expect(account(app, 3).locator('option', { hasText: '@main_e2e' })).toHaveCount(0);
  await expect(account(app, 3).locator('option', { hasText: '@alice' })).toHaveCount(0);
  await expect(account(app, 3).locator('option', { hasText: '@bob' })).toHaveCount(1);
  await account(app, 3).selectOption('acct_200');
  await expect(account(app, 4).locator('option', { hasText: '@bob' })).toHaveCount(0);

  // Removing frees the account again
  await app.getByRole('button', { name: 'Remove participant 3' }).click();
  await expect(rowsOf(app)).toHaveCount(4);
  await expect(add).toBeEnabled();
  await expect(account(app, 3).locator('option', { hasText: '@bob' })).toHaveCount(1);
});

test('first speaker options follow the @mentions of the opening post', async ({ app }) => {
  await mockAccounts(app);
  await openConversationForm(app);
  const first = app.getByLabel('First speaker');
  const speakerOptions = first.locator('option');
  await expect(speakerOptions).toHaveText([/^Random/]);

  const post = app.getByLabel('Opening post text');
  await post.fill('Hello @alice and @MAIN_E2E, talk!');
  await expect(speakerOptions).toHaveText([/^Random/, '@main_e2e', '@alice']);
  await first.selectOption('acct_100');

  // Dropping the mention keeps the choice but flags it
  await post.fill('Hello @main_e2e, talk!');
  await expect(
    app.getByText('The opening post must mention @alice', { exact: false }),
  ).toBeVisible();
  await post.fill('Hello @alice, talk!');
  await expect(app.getByRole('alert')).toHaveCount(0);

  // The opener cannot speak first
  await app.getByLabel('Opener handle').fill('alice');
  await expect(
    app.getByText('posted the opening post, so it cannot also speak first'),
  ).toBeVisible();
});

test('unverified accounts ask for verification; invalid forms do not save', async ({ app }) => {
  // The default account is unverified (no handle) in the real e2e status
  await openConversationForm(app);
  await expect(app.getByText('Verify in Settings first', { exact: false }).first()).toBeVisible();
  await app.getByPlaceholder(/Morning Thread, Daily Quotes/).fill('Chat');
  await app.getByLabel('Opening reply (tweet ID/URL) *').fill('1234567890123456789');
  await app.getByRole('button', { name: 'Create Context' }).click();
  await expect(app.getByRole('button', { name: 'Create Context' })).toBeVisible();
  await expect(app.getByText('Verify in Settings first', { exact: false }).first()).toBeVisible();
});

test('Unlimited vs a fixed number of turns, and the body that is saved', async ({ app }) => {
  await mockAccounts(app);
  const bodies = await captureCreate(app);
  await openConversationForm(app);

  await app.getByPlaceholder(/Morning Thread, Daily Quotes/).fill('Dinner chat');
  await app.getByLabel('Opening reply (tweet ID/URL) *').fill('https://x.com/me/status/4242');
  await account(app, 2).selectOption('acct_300');
  await app.getByLabel('Participant 1 persona').fill('Dry wit');
  await app.getByLabel('Participant 2 persona').fill('Warm and curious');
  await app.getByLabel('Shared prompt (premise & tone)').fill('Two friends discuss colors');
  await app
    .getByLabel('Opening post text')
    .fill('Hey @main_e2e and @carol, what is your favorite hue?');
  await app.getByLabel('Opener handle').fill('@me_e2e');
  await app.getByLabel('First speaker').selectOption('acct_300');

  // Unlimited: no number input, no maxTurns in the body
  await expect(app.getByLabel('Number of turns')).toHaveCount(0);
  await app.getByRole('button', { name: 'Create Context' }).click();
  await expect.poll(() => bodies.length).toBe(1);
  expect(bodies[0]).toMatchObject({
    name: 'Dinner chat',
    mode: 'conversation',
    targetTweetId: '4242',
    conversation: {
      participants: [
        { accountId: 'acct_env', persona: 'Dry wit' },
        { accountId: 'acct_300', persona: 'Warm and curious' },
      ],
      sharedPrompt: 'Two friends discuss colors',
      openingPost: 'Hey @main_e2e and @carol, what is your favorite hue?',
      openerHandle: 'me_e2e',
      firstSpeakerAccountId: 'acct_300',
    },
  });
  const conv = bodies[0].conversation as Record<string, unknown>;
  expect(conv).not.toHaveProperty('maxTurns');
  expect(bodies[0]).not.toHaveProperty('conversationState');

  // Fixed number
  await app.getByRole('button', { name: /Add Tweet Context/ }).click();
  await app.getByRole('radio', { name: 'Conversation' }).click();
  await app.getByLabel('Opening reply (tweet ID/URL) *').fill('1234567890123456780');
  await app.getByLabel('Turns').selectOption('fixed');
  const turns = app.getByLabel('Number of turns');
  await turns.fill('600');
  await expect(app.getByText('Turns must be a whole number from 1 to 500.')).toBeVisible();
  await turns.fill('12');
  await expect(app.getByRole('alert')).toHaveCount(0);
  await app.getByRole('button', { name: 'Create Context' }).click();
  await expect.poll(() => bodies.length).toBe(2);
  expect(bodies[1]).toMatchObject({ mode: 'conversation', conversation: { maxTurns: 12 } });
});
