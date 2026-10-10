import { defineConfig } from '@playwright/test';
import { WEB } from './tests/stack';

/**
 * QA-01: the main paths in Chromium at phone width, against the running demo stack (real API,
 * database, S3, worker and the Telegram stand-in). Start it with `pnpm demo`, then `pnpm e2e`.
 * docs/QA.md section 4; CI job "Browser tests".
 */
export default defineConfig({
  testDir: './tests',
  testMatch: '*.spec.ts',
  globalSetup: './tests/global-setup.ts',
  globalTeardown: './tests/global-teardown.ts',
  // One at a time: the tests share the two demo people (their settings, their timers).
  workers: 1,
  // A failure is looked into, not retried away.
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never', outputFolder: 'report' }]]
    : [['list']],
  outputDir: 'results',
  use: {
    baseURL: WEB,
    browserName: 'chromium',
    viewport: { width: 390, height: 844 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // A browser already on this computer, e.g. E2E_CHROMIUM=/opt/pw-browsers/chromium.
    launchOptions: process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {},
  },
});
