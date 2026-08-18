import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    baseURL: 'http://127.0.0.1:3900',
    headless: true,
  },
  workers: 1, // one host, one temp dataDir: keep tests serial
  timeout: 30000,
  expect: { timeout: 10000 },
});
