/**
 * Core debug scenes — end-to-end. Each scene must boot to `__READY__` with a live canvas and a
 * silent console: these are the pages every other member points `scripts/shot.mjs` at, so a
 * thrown exception or a missing readiness signal here hangs the whole team's visual workflow.
 *
 *   ?scene=core — the 10 000-entity ECS stress scene
 *   ?scene=loop — the fixed-timestep visualizer
 *   ?scene=save — the save/load round-trip proof
 *
 * All scenes load frozen (?freeze=1) with a fixed seed, per playwright.config.ts visual rules.
 */

import { expect, test } from '@playwright/test';

function collectConsoleErrors(page: import('@playwright/test').Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

const READY = () => (window as unknown as { __READY__?: boolean }).__READY__ === true;

for (const scene of ['core', 'loop', 'save']) {
  test.describe(`core scene: ${scene}`, () => {
    test(`?scene=${scene} boots to __READY__ with no console errors`, async ({ page }) => {
      const errors = collectConsoleErrors(page);

      await page.goto(`/?seed=42&tick=120&freeze=1&scene=${scene}`);
      await page.waitForFunction(READY, undefined, { timeout: 30_000 });

      await expect(page.locator('canvas')).toBeVisible();
      expect(errors).toEqual([]);
    });
  });
}

test.describe('core scene determinism', () => {
  test('the stress scene renders an identical frame twice', async ({ page }, testInfo) => {
    const capture = async () => {
      await page.goto('/?seed=42&tick=120&freeze=1&scene=core');
      await page.waitForFunction(READY, undefined, { timeout: 30_000 });
      await page.waitForTimeout(400); // let the overlay settle
      // Clip to the world region right of the dev overlay: the overlay shows live fps/frame
      // counters that legitimately differ between loads, while the frozen world must not.
      return page.screenshot({ clip: { x: 320, y: 0, width: 960, height: 720 } });
    };
    // The second goto remounts the world from the same seed and tick.
    const first = await capture();
    const second = await capture();
    expect(first.equals(second), 'two runs of the same frozen scene must match byte-for-byte').toBe(true);
    await testInfo.attach('core-scene.png', { body: first, contentType: 'image/png' });
  });
});
