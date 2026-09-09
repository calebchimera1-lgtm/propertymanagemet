import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run against the real web app talking to the real API and a
 * real database. Both servers must already be running:
 *
 *   pnpm dev              # or docker compose up
 *   pnpm test:e2e
 *
 * Desktop and mobile are both in the default project list because the mobile
 * layout is designed, not merely narrower — it needs testing as its own thing.
 */
/**
 * Some environments (CI images, sandboxes) ship a Chromium build that does not
 * match this Playwright version's expected revision. Point
 * PLAYWRIGHT_CHROMIUM_PATH at that binary rather than downloading a second one.
 */
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
const launchOptions = executablePath ? { launchOptions: { executablePath } } : {};

export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: process.env.APP_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], ...launchOptions } },
    { name: 'mobile', use: { ...devices['Pixel 7'], ...launchOptions } },
  ],
});
