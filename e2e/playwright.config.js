import { defineConfig } from '@playwright/test';

/**
 * Runs against an already running app (start it with run.bat first).
 * WEB_URL / API_URL can be overridden with environment variables.
 * Uses the installed Google Chrome ("chrome" channel), so no browser download is needed.
 * A fake camera and microphone are used, so camera tests run without hardware.
 */
export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 8_000 },
  fullyParallel: false, // tests share one database; keep them in order
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.WEB_URL ?? 'http://localhost:5173',
    channel: 'chrome',
    headless: true,
    viewport: { width: 1100, height: 850 },
    permissions: ['camera', 'microphone', 'clipboard-read', 'clipboard-write'],
    launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
