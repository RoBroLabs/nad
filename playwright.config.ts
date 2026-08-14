import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';

const port = 3210;
const baseURL = `http://127.0.0.1:${port}`;
const dataDirectory = resolve(process.cwd(), 'test-results/e2e-data');

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'output/playwright/report' }],
  ],
  outputDir: 'output/playwright/results',
  use: {
    ...devices['Desktop Chrome'],
    baseURL,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'node scripts/prepare-e2e.mjs && node .next/standalone/server.js',
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ...process.env,
      APP_NAME: 'NAD Phase 8',
      APP_SECRET: 'phase8-e2e-app-secret-000000000001',
      AUTH_SECRET: 'phase8-e2e-auth-secret-00000000001',
      APP_URL: baseURL,
      AUTH_URL: baseURL,
      HOSTNAME: '127.0.0.1',
      PORT: String(port),
      DATABASE_URL: `file:${resolve(dataDirectory, 'nad.db')}`,
      NAD_DATA_DIR: dataDirectory,
      NAD_MARKETPLACE_MODE: 'manual',
      NAD_MARKETPLACE_URL: 'https://nad.robrolabs.com',
    },
  },
});
