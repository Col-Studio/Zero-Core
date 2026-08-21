import { test, expect } from '@playwright/test';

/**
 * Visual check for the ecology dev harness (`src/ecology/dev/Harness.tsx`), following the same
 * `?seed=&scene=&tick=&freeze=1` convention as every other debug scene (CLAUDE.md § Determinism
 * & the screenshot loop).
 *
 * OPEN QUESTION FOR THE INTEGRATION LEAD (see INTEGRATION_NOTES.md "ecology dev harness
 * routing"): `App.tsx`'s `MODULES` array is empty until merge, and it's frozen, so on a fresh
 * clone of this branch `?scene=ecology` doesn't yet resolve to `EcologyHarness`. This spec
 * assumes that routing exists — either because the lead has wired `MODULES` for local testing,
 * or because a small dev-only entry has been added — and documents the expected contract so it
 * starts passing the moment that routing lands, without needing to change this file.
 */
test.describe('ecology dev harness', () => {
  test('renders the dashboard and reaches a ready state at a fixed seed/tick', async ({ page }) => {
    const problems: string[] = [];
    page.on('pageerror', (err) => problems.push(err.message));

    await page.goto('/?seed=42&scene=ecology&tick=6000&freeze=1', { waitUntil: 'domcontentloaded' });

    await page
      .waitForFunction('window.__READY__ === true', { timeout: 45_000 })
      .catch(() => {
        /* falls through to the settle-delay below, matching scripts/shot.mjs's own fallback */
      });
    await page.waitForTimeout(400);

    await expect(page.getByText(/tick 6000/i)).toBeVisible({ timeout: 10_000 });
    expect(problems, `console/page errors: ${problems.join('; ')}`).toEqual([]);

    await expect(page).toHaveScreenshot('ecology-dashboard-seed42-tick6000.png', {
      maxDiffPixelRatio: 0.02,
    });
  });

  test('is deterministic: the same seed/tick renders the same population history shape twice', async ({ page }) => {
    await page.goto('/?seed=7&scene=ecology&tick=12000&freeze=1', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction('window.__READY__ === true', { timeout: 45_000 }).catch(() => undefined);
    await page.waitForTimeout(400);
    await expect(page).toHaveScreenshot('ecology-dashboard-seed7-tick12000.png', { maxDiffPixelRatio: 0.02 });
  });
});
