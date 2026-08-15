#!/usr/bin/env node
// FROZEN FILE — integration lead only. See CLAUDE.md § Frozen files.
//
// Deterministic screenshot harness — the team's shared art-direction tool.
//
// Every member points this at their own debug scenes, looks at the PNG, and iterates on the
// image rather than on the code. Determinism is the whole point: fixed seed, fixed viewport,
// frozen camera and time, so two runs differ only where the code changed.
//
//   node scripts/shot.mjs --scene=terrain
//   node scripts/shot.mjs --scene=ecology --seed=7 --tick=24000
//   node scripts/shot.mjs --scene=sky --tick=0,6000,12000,18000   (timelapse contact sheet)
//   node scripts/shot.mjs --all=sky,water,weather,vfx --out=artifacts/presentation
//
// Flags: --scene  --seed(42)  --tick(0)  --all  --out  --url  --width  --height
//        --wait(ms extra settle)  --no-freeze  --timeout

import { chromium } from '@playwright/test';
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { resolveLocalChromium } from './chromium-path.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? 'true'];
  }),
);

const BASE = args.url ?? 'http://localhost:5173';
const SEED = args.seed ?? '42';
const OUT = args.out ?? 'artifacts';
const WIDTH = Number(args.width ?? 1280);
const HEIGHT = Number(args.height ?? 720);
const SETTLE = Number(args.wait ?? 400);
const TIMEOUT = Number(args.timeout ?? 45_000);
const FREEZE = args.freeze !== 'false' && args['no-freeze'] !== 'true';

const scenes = (args.all ?? args.scene ?? '').split(',').filter(Boolean);
const ticks = String(args.tick ?? '0').split(',').filter(Boolean);

if (scenes.length === 0) {
  console.error(
    'usage: node scripts/shot.mjs --scene=<name> [--seed=42] [--tick=0,6000] [--out=artifacts]',
  );
  process.exit(1);
}

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  // Falls back to the newest cached Chromium when the pinned one is missing (the CDN is
  // geo-blocked here). Same resolver the e2e config uses, so both launch the same binary.
  executablePath: resolveLocalChromium(),
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--hide-scrollbars',
    // NOT --disable-frame-rate-limit: measured to hang every screenshot under swiftshader.
    // See the note in playwright.config.ts.
  ],
});

const page = await browser.newPage({
  viewport: { width: WIDTH, height: HEIGHT },
  deviceScaleFactor: 1,
});

const problems = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') problems.push(`console: ${msg.text()}`);
});
page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));

let captured = 0;

for (const scene of scenes) {
  for (const tick of ticks) {
    const url =
      `${BASE}/?seed=${SEED}&scene=${scene}&tick=${tick}` + (FREEZE ? '&freeze=1' : '');
    const name = ticks.length > 1 ? `${scene}_seed${SEED}_t${tick}.png` : `${scene}_seed${SEED}.png`;
    const file = join(OUT, name);

    process.stdout.write(`→ ${scene} (tick ${tick}) `);
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });

      // Modules set window.__READY__ = true once assets are loaded and the sim is at `tick`.
      // If a module hasn't implemented it yet, fall back to a plain settle delay.
      await page
        .waitForFunction('window.__READY__ === true', { timeout: TIMEOUT })
        .catch(() => process.stdout.write('(no __READY__ flag) '));

      await page.waitForTimeout(SETTLE);
      await page.screenshot({ path: file, animations: 'disabled' });
      console.log(`✓ ${file}`);
      captured++;
    } catch (err) {
      console.log(`✖ ${err.message.split('\n')[0]}`);
      problems.push(`${scene}@${tick}: ${err.message.split('\n')[0]}`);
    }
  }
}

await browser.close();

console.log(`\n${captured}/${scenes.length * ticks.length} captured → ${OUT}/`);

if (problems.length) {
  console.error(`\n⚠  ${problems.length} problem(s) during capture:`);
  for (const p of problems.slice(0, 20)) console.error(`   ${p}`);
  process.exit(1);
}

console.log('\nNow LOOK at the images. Fix what looks wrong, not just what fails to compile.');
