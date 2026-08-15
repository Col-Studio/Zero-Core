/**
 * Shell smoke test. Small on purpose — its job is to catch the failures that make every other
 * module's screenshots worthless:
 *
 *   • the renderer silently fell back to WebGL1 (or WebGPU crept in)
 *   • the shell throws before `__READY__`, so `scripts/shot.mjs` hangs for all seven branches
 *   • the same seed renders differently twice, which invalidates every visual diff in the project
 *
 * Each module adds its own spec for its own debug scenes; this one guards the ground they stand on.
 */

import { expect, test } from '@playwright/test';

/** Fails the test on any console error — a mounted module throwing must never pass CI. */
function collectConsoleErrors(page: import('@playwright/test').Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

const READY = () => (window as unknown as { __READY__?: boolean }).__READY__ === true;

test.describe('shell', () => {
  test('boots to __READY__ with no console errors', async ({ page }) => {
    const errors = collectConsoleErrors(page);

    await page.goto('/?seed=42&freeze=1');
    await page.waitForFunction(READY, undefined, { timeout: 30_000 });

    await expect(page.locator('canvas')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('renders through a WebGL2 context, never WebGL1 or WebGPU', async ({ page }) => {
    await page.goto('/?seed=42&freeze=1');
    await page.waitForFunction(READY, undefined, { timeout: 30_000 });

    const info = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      if (canvas === null) return null;
      // R3F already holds the context; asking for the same type returns the live one.
      const gl2 = canvas.getContext('webgl2');
      return {
        hasWebgl2: gl2 !== null,
        version: gl2 === null ? null : (gl2.getParameter(gl2.VERSION) as string),
        drawingBufferWidth: gl2?.drawingBufferWidth ?? 0,
      };
    });

    expect(info).not.toBeNull();
    expect(info!.hasWebgl2).toBe(true);
    // "WebGL 2.0 (OpenGL ES 3.0 ...)" — a WebGL1 fallback would read "WebGL 1.0".
    expect(info!.version).toContain('WebGL 2.0');
    expect(info!.drawingBufferWidth).toBeGreaterThan(0);
  });

  test('reflects the seed and freeze flags in the boot readout', async ({ page }) => {
    await page.goto('/?seed=1337&scene=smoke&freeze=1');
    await page.waitForFunction(READY, undefined, { timeout: 30_000 });

    const readout = page.getByText(/WORLD ZERO/);
    await expect(readout).toContainText('seed 1337');
    await expect(readout).toContainText('scene smoke');
    await expect(readout).toContainText('frozen');
  });

  test('falls back to the default seed on a garbage seed param', async ({ page }) => {
    await page.goto('/?seed=not-a-number&freeze=1');
    await page.waitForFunction(READY, undefined, { timeout: 30_000 });
    await expect(page.getByText(/WORLD ZERO/)).toContainText('seed 42');
  });

  test('is deterministic — the same seed renders an identical frame twice', async ({ page }) => {
    const shoot = async () => {
      await page.goto('/?seed=42&freeze=1');
      await page.waitForFunction(READY, undefined, { timeout: 30_000 });
      // One extra frame so the first draw has certainly landed.
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
      return page.locator('canvas').screenshot();
    };

    const first = await shoot();
    const second = await shoot();
    // Byte-identical, not merely similar: the frozen shell has no animation to blur the diff.
    // (Compared as byte arrays rather than via Buffer so this needs no @types/node.)
    expect(new Uint8Array(first)).toEqual(new Uint8Array(second));
  });
});
