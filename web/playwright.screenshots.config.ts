import { defineConfig } from '@playwright/test';

// Used by `make screenshots` to regenerate the images in docs/screenshots.
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/screenshots.e2e.ts',
  workers: 1,
  timeout: 30000,
  use: { browserName: 'chromium', headless: true },
});
