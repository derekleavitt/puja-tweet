/**
 * X ChromaBot - Playwright e2e configuration.
 * Boots the real server (Express + Vite) with auth disabled, an in-memory store and no X/Gemini keys,
 * so every post is simulated. Run with `npm run e2e`.
 */

import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const PORT = 3410;

/** Use the preinstalled Chromium when the bundled revision is missing (sandboxes without downloads). */
function findChromium(): string | undefined {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || !existsSync(root)) return undefined;
  for (const dir of readdirSync(root).filter((d) => /^chromium-\d+$/.test(d))) {
    const bin = path.join(root, dir, 'chrome-linux', 'chrome');
    if (existsSync(bin)) return bin;
  }
  return undefined;
}

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  // On CI the 'github' reporter turns failures into check-run annotations (readable without log access).
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    launchOptions: { executablePath: findChromium() },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: `http://localhost:${PORT}/api/status`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      AUTH_DISABLED: 'true',
      VITE_AUTH_DISABLED: 'true',
      STORE: 'memory',
      TARGET_TWEET_ID: '1700000000000000001',
      PORT: String(PORT),
      TWITTER_API_KEY: '',
      TWITTER_API_SECRET: '',
      TWITTER_ACCESS_TOKEN: '',
      TWITTER_ACCESS_TOKEN_SECRET: '',
      TWITTER_BEARER_TOKEN: '',
      GEMINI_API_KEY: '',
      CREDENTIALS_ENCRYPTION_KEY: '',
    },
  },
});
