import {defineConfig} from '@playwright/test';

const port = process.env.PAGES_TEST_PORT || '4173';
const baseURL = `http://127.0.0.1:${port}/vacuum_chamber/`;

export default defineConfig({
  testDir: './tests',
  testMatch: 'pages.spec.mjs',
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  expect: {timeout: 45_000},
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL,
    browserName: 'chromium',
    viewport: {width: 1440, height: 1000},
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
      args: ['--enable-unsafe-swiftshader'],
    },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node scripts/serve-pages.mjs',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 15_000,
  },
});
