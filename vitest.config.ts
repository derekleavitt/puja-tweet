/**
 * Vitest configuration for X ChromaBot.
 * Tests run in Node, never touch the network, and write only to a temp DATA_DIR.
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/helpers/setup.ts'],
  },
});
