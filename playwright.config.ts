import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  },
  webServer: { command: 'npm run build && npx vite preview --port 4173 --host 127.0.0.1', url: 'http://127.0.0.1:4173', reuseExistingServer: true, timeout: 180_000 },
});
