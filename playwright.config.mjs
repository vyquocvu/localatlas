import { defineConfig } from '@playwright/test';
const port = Number(process.env.LOCALATLAS_E2E_PORT || 3457);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  outputDir: 'node_modules/.cache/playwright-results',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL,
    browserName: 'chromium',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run cli -- serve',
    url: `${baseURL}/`,
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      PORT: String(port),
      LOCALATLAS_HOME: process.env.LOCALATLAS_HOME,
    },
  },
});
