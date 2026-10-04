/**
 * X ChromaBot - e2e fixtures
 * Every test fails on console errors, uncaught page errors and unexpected 4xx/5xx /api responses.
 * A test that provokes an error on purpose registers it with `expectError(/pattern/)`.
 */

import { test as base, expect, type Page } from '@playwright/test';

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

export const TABS = ['Studio', 'Campaigns', 'Queue', 'Logs', 'Timing', 'API Keys'] as const;
export type Tab = (typeof TABS)[number];

/** Opens the app and waits for the header nav (rendered once auth has resolved). */
export async function openApp(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Studio', exact: true }).first()).toBeVisible();
}

export async function openTab(page: Page, tab: Tab) {
  await page.getByRole('button', { name: tab, exact: true }).first().click();
}
