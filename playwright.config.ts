import { defineConfig, devices } from '@playwright/test';

// FROZEN FILE — integration lead only. See CLAUDE.md § Frozen files.
//
// Visual determinism rules:
//   • fixed viewport — screenshots must be comparable across machines
//   • single worker for visual specs — GPU contention changes frame timing
//   • always load scenes with ?seed=<n>&freeze=1
export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './test-results',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 60_000,
  expect: {
    // Low tolerance: GPU driver differences cause tiny deltas, real regressions cause big ones.
    toHaveScreenshot: { maxDiffPixelRatio: 0.02, animations: 'disabled' },
  },
  use: {
    baseURL: 'http://localhost:4173',
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      // Software WebGL keeps CI headless runs consistent. Locally, drop --use-gl=swiftshader
      // for real GPU performance measurements.
      args: [
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--disable-frame-rate-limit',
      ],
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
