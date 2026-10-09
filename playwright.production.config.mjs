import { defineConfig } from '@playwright/test';

// Test the emitted CSS/import graph, not Vite's development style injection.
// Keep these assets separate from dist so a running workspace is untouched.
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: ['root-assets.production.spec.mjs', 'mobile-layout.spec.mjs'],
  workers: 1,
  timeout: 60_000,
  use: {
    baseURL: 'http://127.0.0.1:6474',
    browserName: 'chromium',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm exec vite build --outDir .scratch/mobile-production/dist --emptyOutDir && pnpm exec vite preview --outDir .scratch/mobile-production/dist --host 127.0.0.1 --port 6474 --strictPort',
    url: 'http://127.0.0.1:6474',
    reuseExistingServer: false,
    timeout: 120_000,
    env: { NODE_ENV: 'production' },
  },
});
