#!/usr/bin/env node
// FROZEN FILE — integration lead only. See CLAUDE.md § Frozen files.
//
// Architecture guard. This script is what makes 7 isolated agents merge cleanly, so it runs
// on every push and PR. It enforces:
//
//   1. No cross-module imports        — modules talk only via @contracts + the event bus
//   2. No Math.random()               — determinism; use rng from @contracts/rng
//   3. No Date.now()/performance.now() in simulation code
//   4. No edits to frozen files       — (only when a git base ref is available)
//   5. Files under 400 lines          — small files, small context, better AI output
//   6. No orphaned events             — every event has an emitter and a listener
//
// Escape hatch: append `// allow-boundary: <reason>` on the offending line. Use it rarely and
// say why; the integration lead reviews every one of these.

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');

const MODULES = ['core', 'world', 'ecology', 'creatures', 'player', 'society', 'presentation'];

const FROZEN = [
  'src/contracts/',
  'src/main.tsx',
  'src/App.tsx',
  'vite.config.ts',
  'vitest.config.ts',
  'playwright.config.ts',
  'tsconfig.json',
  'package.json',
  'CLAUDE.md',
  '.github/',
  'scripts/check-boundaries.mjs',
];

const MAX_LINES = 400;
const ALLOW = /\/\/\s*allow-boundary/;

/**
 * True for lines that are pure comment or JSDoc prose. The content checks below skip these:
 * documentation that *names* a banned API (as rng.ts does when it explains why Math.random() is
 * forbidden) must not be reported as a use of it. Code with a trailing comment is still checked,
 * since the code part comes first on the line.
 */
const isCommentLine = (text) => /^\s*(?:\/\/|\/\*|\*)/.test(text);

const errors = [];
const warnings = [];

const fail = (file, line, msg) => errors.push({ file, line, msg });
const warn = (file, line, msg) => warnings.push({ file, line, msg });

// ---------------------------------------------------------------- file walking

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry)) out.push(full);
  }
  return out;
}

const rel = (f) => relative(ROOT, f).split(sep).join('/');

/** Which module does this file belong to? null for contracts / shell / scripts. */
function moduleOf(relPath) {
  const m = /^src\/([^/]+)\//.exec(relPath);
  return m && MODULES.includes(m[1]) ? m[1] : null;
}

// ---------------------------------------------------------------- checks

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)[^;\n]*?from\s+['"]([^'"]+)['"]/g;
const DYNAMIC_RE = /import\(\s*['"]([^'"]+)['"]\s*\)/g;

function checkFile(file) {
  const relPath = rel(file);
  const src = readFileSync(file, 'utf8');
  const lines = src.split('\n');
  const owner = moduleOf(relPath);
  const isDev = /\/dev\//.test(relPath);
  const lineOf = (index) => src.slice(0, index).split('\n').length;

  // 1. cross-module imports
  for (const re of [IMPORT_RE, DYNAMIC_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src))) {
      const spec = m[1];
      const line = lineOf(m.index);
      if (ALLOW.test(lines[line - 1] ?? '')) continue;

      const aliased = /^@([^/]+)\//.exec(spec);
      if (aliased && MODULES.includes(aliased[1]) && owner && aliased[1] !== owner) {
        fail(
          relPath,
          line,
          `cross-module import of @${aliased[1]} from module '${owner}'. ` +
            `Use the @contracts event bus or a service interface instead.`,
        );
      }
      // deep relative escapes: ../../<othermodule>/...
      if (spec.startsWith('.') && owner) {
        const parts = spec.split('/');
        const hop = parts.find((p) => MODULES.includes(p));
        if (hop && hop !== owner) {
          fail(relPath, line, `relative import reaches into module '${hop}' from '${owner}'.`);
        }
      }
    }
  }

  // 2. Math.random — determinism killer
  lines.forEach((text, i) => {
    if (ALLOW.test(text) || isCommentLine(text)) return;
    if (/\bMath\.random\s*\(/.test(text)) {
      fail(relPath, i + 1, `Math.random() is banned. Use rng from '@contracts/rng'.`);
    }
  });

  // 3. wall-clock in simulation code (presentation + dev harnesses are exempt)
  if (owner && owner !== 'presentation' && !isDev) {
    lines.forEach((text, i) => {
      if (ALLOW.test(text) || isCommentLine(text)) return;
      if (/\b(?:Date\.now\s*\(|performance\.now\s*\(|new Date\s*\()/.test(text)) {
        fail(
          relPath,
          i + 1,
          `wall-clock time in simulation code breaks determinism and replay. Use the injected tick.`,
        );
      }
    });
  }

  // 5. file length
  if (lines.length > MAX_LINES) {
    fail(relPath, lines.length, `file is ${lines.length} lines (limit ${MAX_LINES}). Split it.`);
  }
}

/**
 * 6. Events declared in contracts must be both emitted and listened to somewhere.
 *
 * Only meaningful once every module is present. On a single-module branch, 28 of the 31 events
 * are *expected* to be unwired — reporting them there would bury the real signal and train
 * everyone to ignore warnings. So this runs on the fully merged tree (or when FORCE_EVENT_WIRING
 * is set) and prints one explanatory line otherwise.
 */
function checkEventWiring(files) {
  const eventsFile = join(SRC, 'contracts', 'events.ts');
  if (!existsSync(eventsFile)) return; // pre-Card-1: nothing to check yet

  const present = MODULES.filter((m) => existsSync(join(SRC, m)));
  const missing = MODULES.filter((m) => !present.includes(m));
  if (missing.length > 0 && !process.env.FORCE_EVENT_WIRING) {
    console.log(
      `ℹ  event-wiring check skipped — not yet merged (missing: ${missing.join(', ')}). ` +
        `Set FORCE_EVENT_WIRING=1 to run it anyway.`,
    );
    return;
  }

  const decl = readFileSync(eventsFile, 'utf8');

  // event names look like 'creature:died' / "village:economyChanged"
  const declared = new Set(
    [...decl.matchAll(/['"]([a-z][a-zA-Z]*:[a-zA-Z]+)['"]/g)].map((m) => m[1]),
  );
  if (declared.size === 0) return;

  const emitted = new Set();
  const listened = new Set();
  for (const file of files) {
    if (rel(file).startsWith('src/contracts/')) continue;
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/emit\s*\(\s*\{?\s*(?:type\s*:\s*)?['"]([^'"]+)['"]/g)) {
      emitted.add(m[1]);
    }
    for (const m of src.matchAll(/\bon\s*\(\s*['"]([^'"]+)['"]/g)) listened.add(m[1]);
  }

  for (const name of declared) {
    const e = emitted.has(name);
    const l = listened.has(name);
    if (!e && !l) warn('src/contracts/events.ts', 0, `event '${name}' is never emitted or heard.`);
    else if (!e) warn('src/contracts/events.ts', 0, `event '${name}' has listeners but no emitter.`);
    else if (!l) warn('src/contracts/events.ts', 0, `event '${name}' is emitted but nobody listens.`);
  }
}

/** 4. frozen-file edits, relative to a base ref. Skipped when git/base is unavailable. */
function checkFrozen() {
  const base = process.env.FROZEN_BASE;
  if (!base) return;
  let changed = [];
  try {
    const out = execSync(`git diff --name-only ${base}...HEAD`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    changed = out.split('\n').filter(Boolean);
  } catch {
    warn('.', 0, `could not diff against ${base}; frozen-file check skipped.`);
    return;
  }
  for (const f of changed) {
    if (FROZEN.some((p) => (p.endsWith('/') ? f.startsWith(p) : f === p))) {
      fail(f, 0, `frozen file modified. Only the integration lead may change this.`);
    }
  }
}

// ---------------------------------------------------------------- run

const files = walk(SRC).concat(walk(join(ROOT, 'tests')));
files.forEach(checkFile);
checkEventWiring(files);
checkFrozen();

const label = (list) =>
  list.map((e) => `  ${e.file}${e.line ? `:${e.line}` : ''}\n      ${e.msg}`).join('\n');

if (warnings.length) {
  console.log(`\n⚠  ${warnings.length} warning(s):\n${label(warnings)}`);
}

if (errors.length) {
  console.error(`\n✖ ${errors.length} boundary violation(s):\n${label(errors)}\n`);
  console.error(`See CLAUDE.md § Hard invariants. Escape hatch: // allow-boundary: <reason>\n`);
  process.exit(1);
}

console.log(`✓ boundaries clean — ${files.length} file(s) checked`);
