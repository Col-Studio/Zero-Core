import { defineConfig, devices } from '@playwright/test';
// @ts-expect-error — plain .mjs helper, shared with scripts/shot.mjs so the two can't disagree
// about which browser they launch. See scripts/chromium-path.mjs.
import { resolveLocalChromium } from './scripts/chromium-path.mjs';

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
      // See resolveLocalChromium above. Set PW_CHROMIUM_PATH to force a specific binary;
      // undefined means "use the browser Playwright installed", which is what CI does.
      executablePath: resolveLocalChromium(),
      // Software WebGL keeps CI headless runs consistent. Locally, swap in a real GPU
      // (drop --use-angle=swiftshader) when you need honest frame-time numbers.
      //
      // Do NOT add --disable-frame-rate-limit here. Measured: with it, every page.screenshot()
      // hangs until timeout under swiftshader — uncapped rAF starves the compositor's capture
      // path, so Playwright waits forever for a stable frame. It broke the whole visual loop.
      // For perf runs only, set PW_UNCAP_FPS=1.
      args: [
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        ...(process.env.PW_UNCAP_FPS ? ['--disable-frame-rate-limit'] : []),
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
