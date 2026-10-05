/**
 * X ChromaBot - conversation campaign card, preview, queue and logs
 * The server side is mocked with page.route (status with a conversation campaign, template
 * preview, post-now, restart, queue, history), so no X account or AI key is needed.
 */

import type { Page } from '@playwright/test';
import { test, expect, openApp, openTab, campaignCard } from './fixtures.js';

const HANDLES = ['main_e2e', 'alice', 'bob', 'carol'];
const IDS = ['acct_env', 'acct_100', 'acct_200', 'acct_300'];
const NAME = 'Salon Debate';

interface Mock {
  live: boolean;
  ctx: Record<string, unknown>;
  postBodies: Record<string, unknown>[];
  restartBodies: Record<string, unknown>[];
  postStatus: number;
}

const conversationContext = (overrides: Record<string, unknown> = {}) => ({
  id: 'ctx_conv',
  name: NAME,
  targetTweetId: '1900000000000000001',
  enabled: true,
  dryRun: false,
  mode: 'conversation',
  schedule: { mode: 'interval', intervalMinutes: 60, timezone: 'UTC' },
  template: '',
  themePreference: 'dynamic',
  hashtags: [],
  conversation: {
    participants: [
      { accountId: IDS[1], persona: 'dry wit' },
      { accountId: IDS[2], persona: 'earnest' },
      { accountId: IDS[3], persona: 'skeptic' },
    ],
    sharedPrompt: 'Three friends argue about whether pineapple belongs on pizza.',
    openingPost: 'Hot take @alice @bob @carol',
    maxTurns: 20,
  },
  conversationState: {
    runId: 'run_1',
    turnCount: 3,
    nextSpeakerAccountId: IDS[2],
  },
  ...overrides,
});

const PREVIEW = {
  success: true,
  previewText: '@carol pineapple is a fruit, not a crime.',
  charCount: 41,
  replyToTweetId: '1900000000000000099',
  lastPostedTweetId: '1900000000000000099',
  isFirstInChain: false,
  accountId: IDS[2],
  accountHandle: 'bob',
  conversation: {
    runId: 'run_1',
    turnNumber: 4,
    speakerAccountId: IDS[2],
    speakerHandle: 'bob',
    nextSpeakerAccountId: IDS[3],
    nextSpeakerHandle: 'carol',
    summaryUsed: false,
    transcriptLength: 3,
  },
};

async function setup(page: Page, opts: { live?: boolean; ctx?: Record<string, unknown> } = {}) {
  const mock: Mock = {
    live: opts.live ?? false,
    ctx: opts.ctx ?? conversationContext(),
    postBodies: [],
    restartBodies: [],
    postStatus: 200,
  };

  await page.route('**/api/status', async (route) => {
    const res = await route.fetch();
    const json = await res.json();
    json.accounts = HANDLES.map((handle, i) => ({
      id: IDS[i],
      label: `@${handle}`,
      handle,
      userId: String(i),
      status: 'ok',
      createdAt: new Date().toISOString(),
      isDefault: i === 0,
    }));
    json.contexts = [mock.ctx];
    json.settings = { ...json.settings, globalDryRun: !mock.live };
    await route.fulfill({ response: res, json });
  });
  await page.route('**/api/template/preview', (route) => route.fulfill({ json: PREVIEW }));
  await page.route('**/api/post-now', async (route) => {
    mock.postBodies.push(route.request().postDataJSON() as Record<string, unknown>);
    if (mock.postStatus === 409) {
      return route.fulfill({
        status: 409,
        json: { success: false, error: 'Conversation moved on, refresh the preview' },
      });
    }
    await route.fulfill({
      json: {
        success: true,
        result: { success: true, simulated: true },
        log: {
          id: 'log_1',
          timestamp: new Date().toISOString(),
          slotType: 'manual',
          targetTweetId: '1900000000000000001',
          color: { name: 'x', hex: '#000000' },
          tweetText: PREVIEW.previewText,
          status: 'simulated',
          contextId: 'ctx_conv',
          accountHandle: 'bob',
          turn: 4,
        },
      },
    });
  });
  await page.route('**/api/contexts/ctx_conv/conversation/restart', async (route) => {
    mock.restartBodies.push(route.request().postDataJSON() as Record<string, unknown>);
    mock.ctx = conversationContext({
      targetTweetId: '1900000000000000777',
      conversationState: { runId: 'run_2', turnCount: 0, nextSpeakerAccountId: IDS[1] },
    });
    await route.fulfill({ json: { success: true } });
  });
  await page.route(/\/api\/queue(\?|$)/, (route) =>
    route.fulfill({
      json: {
        queue: [0, 1, 2].map((i) => ({
          slotId: `slot_${i}`,
          dateStr: '2030-01-0' + (i + 1),
          timeSlot: '06:00',
          slotType: 'morning',
          color: { name: 'x', hex: '#000000' },
          contextId: 'ctx_conv',
          contextName: NAME,
          targetTweetId: '1900000000000000001',
          ...(i === 0 ? { speakerAccountId: IDS[2], accountHandle: 'bob' } : {}),
        })),
      },
    }),
  );
  await page.route('**/api/history', (route) =>
    route.fulfill({
      json: {
        logs: [
          {
            id: 'log_a',
            timestamp: new Date().toISOString(),
            slotType: 'manual',
            targetTweetId: '1900000000000000001',
            color: { name: 'x', hex: '#000000' },
            tweetText: '@bob turn three text',
            status: 'simulated',
            contextId: 'ctx_conv',
            contextName: NAME,
            accountHandle: 'alice',
            conversationRunId: 'run_1',
            turn: 3,
          },
        ],
      },
    }),
  );
  return mock;
}

test('card shows the cast, the next speaker and the shared prompt, and hides single-only bits', async ({
  app,
}) => {
  await setup(app);
  await openApp(app);
  const card = campaignCard(app, NAME);
  await expect(card.getByText('Conversation', { exact: true })).toBeVisible();
  await expect(card.getByTestId('conversation-cast')).toHaveText('Cast: @alice · @bob · @carol');
  await expect(card.getByTestId('conversation-next')).toHaveText('Next: @bob · Turn 4/20');
  await expect(card.getByTestId('conversation-prompt')).toContainText('pineapple belongs on pizza');
  await expect(card.getByTestId('posts-as')).toHaveCount(0);
  await expect(card.getByText('Template:')).toHaveCount(0);
  await expect(card.getByText('Hashtags', { exact: false })).toHaveCount(0);
});

test('unlimited conversation shows "Turn n" without a total', async ({ app }) => {
  const ctx = conversationContext();
  (ctx.conversation as Record<string, unknown>).maxTurns = undefined;
  await setup(app, { ctx });
  await openApp(app);
  await expect(campaignCard(app, NAME).getByTestId('conversation-next')).toHaveText(
    'Next: @bob · Turn 4',
  );
});

test('preview names the turn and posts with the conversation echo after a live confirm', async ({
  app,
}) => {
  const mock = await setup(app, { live: true });
  await openApp(app);
  const card = campaignCard(app, NAME);
  await card.getByRole('button', { name: 'Preview & post' }).click();
  const panel = card.getByTestId('campaign-preview');
  await expect(panel.getByTestId('preview-title')).toHaveText('Turn 4 · @bob → @carol');
  await expect(panel.getByTestId('preview-destination')).toHaveText(
    'Reply to #1900000000000000099 as @bob',
  );
  await expect(panel.getByTestId('tweet-preview-text')).toHaveText(PREVIEW.previewText);
  await expect(panel.getByTestId('preview-hashtags')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Morning', exact: true })).toHaveCount(0);

  await panel.getByRole('button', { name: 'Post now (live)' }).click();
  await expect(app.getByRole('alertdialog')).toContainText('as @bob');
  await app.getByRole('button', { name: 'Post live' }).click();
  await expect(panel.getByText('Reply Simulated Successfully')).toBeVisible();

  expect(mock.postBodies).toHaveLength(1);
  expect(mock.postBodies[0]).toMatchObject({
    contextId: 'ctx_conv',
    text: PREVIEW.previewText,
    conversation: {
      runId: 'run_1',
      turnNumber: 4,
      speakerAccountId: IDS[2],
      nextSpeakerAccountId: IDS[3],
    },
  });
});

test('a 409 shows "moved on" and reloads the preview', async ({ app, expectError }) => {
  expectError(/409/);
  expectError(/409/i);
  const mock = await setup(app);
  mock.postStatus = 409;
  await openApp(app);
  const card = campaignCard(app, NAME);
  await card.getByRole('button', { name: 'Preview & post' }).click();
  const panel = card.getByTestId('campaign-preview');
  await expect(panel.getByTestId('tweet-preview-text')).toHaveText(PREVIEW.previewText);

  let previews = 0;
  await app.route('**/api/template/preview', (route) => {
    previews += 1;
    return route.fulfill({ json: PREVIEW });
  });
  await panel.getByRole('button', { name: 'Post now (simulated)' }).click();
  await expect(panel.getByTestId('preview-notice')).toHaveText(
    'The conversation moved on — preview refreshed',
  );
  await expect.poll(() => previews).toBeGreaterThan(0);
  expect(mock.postBodies).toHaveLength(1);
});

test('finished conversation shows the reason and Restart posts the new opening', async ({
  app,
}) => {
  const mock = await setup(app, {
    ctx: conversationContext({
      enabled: false,
      autoPausedReason: 'Conversation finished (20 turns).',
      conversationState: { runId: 'run_1', turnCount: 20, nextSpeakerAccountId: IDS[2] },
    }),
  });
  await openApp(app);
  const card = campaignCard(app, NAME);
  await expect(card.getByTestId('conversation-finished')).toHaveText(
    'Conversation finished (20 turns). Resume to continue this thread for 20 more turns, or Restart to begin a new thread.',
  );
  await card.getByRole('button', { name: 'Restart' }).click();
  const modal = app.getByRole('dialog', { name: 'Restart conversation' });
  await modal
    .getByLabel('New opening reply (tweet ID/URL)')
    .fill('https://x.com/me/status/1900000000000000777');
  await modal.getByLabel('Opening post text').fill('New topic @alice @bob');
  await modal.getByLabel('Opener handle (optional)').fill('@me');
  await modal.getByLabel('First speaker').selectOption({ label: '@alice' });
  await modal.getByRole('button', { name: 'Restart conversation' }).click();

  await expect(modal).toHaveCount(0);
  expect(mock.restartBodies).toEqual([
    {
      targetTweetId: '1900000000000000777',
      openingPost: 'New topic @alice @bob',
      openerHandle: 'me',
      firstSpeakerAccountId: IDS[1],
    },
  ]);
  // Contexts were refreshed: the card is on turn 1 of the new run.
  await expect(card.getByTestId('conversation-next')).toHaveText('Next: @alice · Turn 1/20');
});

test('Restart on a running conversation first confirms a new thread', async ({ app }) => {
  await setup(app);
  await openApp(app);
  const card = campaignCard(app, NAME);
  await card.getByRole('button', { name: 'Restart' }).click();
  await expect(app.getByRole('alertdialog')).toContainText('starts a new conversation thread');
  await app.getByRole('button', { name: 'Continue' }).click();
  await expect(app.getByRole('dialog', { name: 'Restart conversation' })).toBeVisible();
});

test('queue labels the voices and logs show the speaker and turn', async ({ app }) => {
  await setup(app);
  await openApp(app);
  await openTab(app, 'Queue');
  await expect(app.getByTestId('queue-conversation-banner')).toContainText(
    'Conversation (3 voices)',
  );
  const slots = app.getByTestId('queue-slot');
  await expect(slots).toHaveCount(3);
  await expect(slots.nth(0)).toContainText('@bob (next)');
  await expect(slots.nth(1)).toContainText('random voice');
  await expect(slots.nth(2)).toContainText('random voice');
  await expect(slots.nth(1)).toContainText('✨ AI turn, written when it posts');

  await openTab(app, 'Logs');
  await expect(app.getByTestId('history-turn')).toHaveText('@alice · Turn 3');
});
