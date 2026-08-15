// FROZEN FILE — integration lead only. See CLAUDE.md § Frozen files.
//
// Shared by playwright.config.ts and scripts/shot.mjs so the two can never disagree about which
// browser they launch. If they disagreed, a screenshot taken by shot.mjs and a baseline taken by
// the e2e suite would come from different Chromium builds and diff forever.

import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Find a Chromium we can actually launch.
 *
 * `npx playwright install` returns 403 from the CDN in our region, so the pinned build is often
 * absent locally while an older one sits in the cache. Without this, `npm run test:e2e` fails on
 * a fresh checkout with "Executable doesn't exist" — for all seven of us, for a reason that has
 * nothing to do with anyone's code.
 *
 * Precedence: explicit override → pinned build (always, in CI) → newest cached build.
 * CI never auto-resolves: the pinned browser is what makes screenshots comparable, and a silent
 * version drift on the machine that gates PRs would make every baseline meaningless.
 *
 * @returns {string | undefined} path to a Chromium binary, or undefined to let Playwright pick.
 */
export function resolveLocalChromium() {
  if (process.env.PW_CHROMIUM_PATH) return process.env.PW_CHROMIUM_PATH;
  if (process.env.CI) return undefined;

  const home = homedir();
  const root =
    process.env.PLAYWRIGHT_BROWSERS_PATH ||
    (process.platform === 'win32'
      ? join(process.env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'ms-playwright')
      : process.platform === 'darwin'
        ? join(home, 'Library', 'Caches', 'ms-playwright')
        : join(home, '.cache', 'ms-playwright'));

  const rel =
    process.platform === 'win32'
      ? join('chrome-win64', 'chrome.exe')
      : process.platform === 'darwin'
        ? join('chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium')
        : join('chrome-linux', 'chrome');

  let best;
  try {
    for (const dir of readdirSync(root)) {
      const match = /^chromium-(\d+)$/.exec(dir);
      if (!match) continue;
      const rev = Number(match[1]);
      const exe = join(root, dir, rel);
      if (existsSync(exe) && (best === undefined || rev > best.rev)) best = { rev, exe };
    }
  } catch {
    return undefined; // no cache directory — let Playwright report its own error
  }
  return best?.exe;
}
