import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  workers: 1,
  timeout: 30000,
  use: { browserName: 'chromium', headless: true },
});
