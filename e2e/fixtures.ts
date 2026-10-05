/**
 * X ChromaBot - e2e fixtures
 * Every test fails on console errors, uncaught page errors and unexpected 4xx/5xx /api responses.
 * A test that provokes an error on purpose registers it with `expectError(/pattern/)`.
 */

import { test as base, expect, type Locator, type Page } from '@playwright/test';

interface Fixtures {
  allowed: RegExp[];
  /** Whitelists an error (console text or "STATUS url") that the test asserts on purpose. */
  expectError: (pattern: RegExp) => void;
  app: Page;
}

export const test = base.extend<Fixtures>({
  allowed: async ({ page }, use) => {
    void page;
    await use([]);
  },
  expectError: async ({ allowed }, use) => {
    await use((pattern) => allowed.push(pattern));
  },
  app: async ({ page, allowed }, use) => {
    const problems: string[] = [];
    const record = (msg: string) => {
      if (!allowed.some((p) => p.test(msg))) problems.push(msg);
    };
    page.on('console', (m) => {
      if (m.type() === 'error') record(`console.error: ${m.text()} (${m.location().url})`);
    });
    page.on('pageerror', (e) => record(`pageerror: ${e.message}`));
    page.on('response', (r) => {
      if (r.url().includes('/api/') && r.status() >= 400) record(`${r.status()} ${r.url()}`);
    });
    await use(page);
    expect(problems, 'unexpected browser/API errors').toEqual([]);
  },
});

export { expect };

export const TABS = ['Campaigns', 'Queue', 'Logs', 'Settings', 'API Keys'] as const;
export type Tab = (typeof TABS)[number];

/** Opens the app and waits for the header nav (rendered once auth has resolved). */
export async function openApp(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Campaigns', exact: true }).first()).toBeVisible();
}

export async function openTab(page: Page, tab: Tab) {
  await page.getByRole('button', { name: tab, exact: true }).first().click();
}

/** The card of the campaign named `name` on the Campaigns screen. */
export function campaignCard(page: Page, name: string): Locator {
  return page
    .getByTestId('campaign-card')
    .filter({ has: page.getByRole('heading', { name, exact: true }) });
}

/** Opens a campaign card's "Preview & post" panel and waits for the rendered preview text. */
export async function openPreview(page: Page, name: string): Promise<Locator> {
  const card = campaignCard(page, name);
  await card.getByRole('button', { name: 'Preview & post' }).click();
  const preview = card.getByTestId('campaign-preview');
  await expect(preview.getByTestId('tweet-preview-text')).not.toHaveText(/^(Rendering preview…)?$/);
  return preview;
}

export const PRIMARY = 'Primary Eternal Colors';
