# CONTRACTS HANDOFF — Phase 1 complete

**From:** integration lead · **To:** Members 2–7 · **Status:** ✅ ready, you are unblocked

The frozen contracts package is on the **`core`** branch. Branch off it — `git fetch && git
checkout -b <your-module> origin/core` — then start your card. Everything below is what you need to
know that isn't obvious from reading the code.

---

## Verified, not just compiled

| Gate | Result |
|---|---|
| `npm run typecheck` | 0 errors |
| `npm run boundaries` | clean, 23 files checked |
| `npm run test` | **122 passing**, 6 files |
| Coverage | **97.1% statements / 89.2% branch** (gate set at 80%, CI fails below) |
| `npm run test:e2e` | **5 passing** |
| Shell screenshot | captured and visually inspected — lit ground plane, correct readout |
| Determinism | asserted twice over: state hash in unit tests, byte-identical PNG in e2e |

Measured shell frame time: the empty shell renders one plane and holds 60 fps under software
WebGL (swiftshader). Your module owns its own budget from here — state your measured number.

---

## Three bugs I found by running things, that would have hit all six of you

**1. `--disable-frame-rate-limit` hung every screenshot.** It was in both `playwright.config.ts`
and `scripts/shot.mjs`. Under swiftshader, uncapped rAF starves the compositor's capture path, so
`page.screenshot()` waits forever for a stable frame. Symptom: your visual loop times out at 60 s
with no error explaining why. **Removed.** The e2e suite went from 3.4 min to 12 s. If you need
uncapped fps for a perf measurement, set `PW_UNCAP_FPS=1` — but never for screenshots.

**2. Missing favicon broke "no console errors".** The browser requested `/favicon.ico`, got a 404,
and logged a console error — which would fail *your* module's console-error assertion for a reason
that has nothing to do with your module. Fixed with an inline SVG favicon in `index.html`.

**3. `rng.fork()` derived from live state.** Forking after N draws produced a different stream than
forking before them, which is the exact desync forks exist to prevent. Now derived from the
original seed. **If you cached fork output before this fix, re-baseline your screenshots.**

---

## The rules that will actually bite you

**Never cache a service.** Resolve through the accessor at use time:

```ts
// ✅ sees the real module after the merge swap
const h = ctx.services.world().getHeightAt(x, z);

// ❌ holds a Null forever; the merge silently does nothing
const world = ctx.services.world();   // at mount
```

The registry logs `[registry] reading Null 'world'` once per service the first time you read a
Null. That message is **expected** while you develop standalone. After the merge it means a bug.

**Nulls are deliberately alive, not zeros.** Terrain has >20 m of relief and is continuous;
populations drift in ~0.38..0.86 and never hit 0 or 1; `NullPlayerQuery` orbits at r=120 over a
4800-tick period at +1.7 m eye height; there are four **immortal stationary training dummies** at
(±6, ±6) for combat work, plus six orbiters. `getRecentCascades()` returns `[]` on purpose —
handle an empty history.

**`ecology` only remembers `cause: 'player'`.** Natural deaths do not enter the pressure ledger.
If you emit `creature:died` with a wrong cause, the world forgets what the player did, and the
game's premise breaks silently. Always emit an accurate cause.

**The bus defers nested emits.** An event emitted from inside a listener is queued and drained
FIFO after the current dispatch completes — it does not interrupt delivery. Cascades depend on
this. Tested to 50 levels deep with no stack recursion. Listener errors are caught and never
propagate, so one module throwing can't halt the other six.

**`markReady()` exactly once**, when your scene has loaded *and* reached the requested tick.
`scripts/shot.mjs` waits on it; skip it and it falls back to a fixed delay and captures a
half-loaded scene.

---

## Two contract changes since the card

- **`events.ts` is now a barrel** over `src/contracts/events/{creatures,ecology,world,society,player}.ts`
  (the 400-line rule applied to me too). Import path is unchanged: `@contracts/events`.
- **`parseSessionParams` hardened.** `?seed=` empty now yields the default 42 rather than 0, and
  `?scene=` empty yields `null` rather than `''` — otherwise every module's scene switch would
  match a scene named `''`.

The event-wiring check is **skipped until all seven modules are present**. On your branch, 28 of
31 events are legitimately unwired; reporting that would bury real signal. Run
`FORCE_EVENT_WIRING=1 npm run boundaries` if you want to see it anyway.

---

## Known gaps — mine to close, not yours

Phase 2 (`src/core/`) is not built yet and runs in parallel with your work: the ECS, the 20 Hz
fixed-timestep loop, save/load, the dev overlay, and the perf harness. **Nothing in your card
depends on it.** Until the loop lands, drive your own tick in your harness.

`App.tsx` has all seven `MODULES` entries commented out in merge order. At merge each branch
uncomments exactly one line and adds one `registry.register()` call. Conflicts there are expected
and trivial.

**Playwright's CDN is geo-blocked in our region** (403 on `npx playwright install`), so the pinned
browser build is usually missing from your cache. **You do not need to do anything about this** —
`playwright.config.ts` and `scripts/shot.mjs` share `scripts/chromium-path.mjs`, which falls back to
the newest Chromium already in your `ms-playwright` cache. `npm run verify` passes on a bare
checkout with no env vars. If you have no cached Chromium at all, point `PW_CHROMIUM_PATH` at any
Chrome/Chromium binary. CI never auto-resolves — there the pinned browser is what makes screenshots
comparable, so don't set it in a workflow.

---

## If a contract is wrong

Do **not** edit `src/contracts/**`. Write it in your `INTEGRATION_NOTES.md` and tell me. I amend
it for all seven branches at once. Divergent contracts are the single thing that breaks this
architecture — one member's local fix becomes everyone's merge conflict.

---

## Member 3 — ecology

Everything below is also in `src/ecology/README.md` (architecture, tuning knobs); this section
is just what *you*, the integration lead, need to do or know.

### Wiring `mountEcology` into the registry

`ctx.services` is `ServiceRegistryLike` (read-only), so `mountEcology(ctx)` cannot call
`registry.register('ecology', ...)` itself — only `App.tsx` holds the real `ServiceRegistry`.
When you uncomment ecology's `MODULES` row, also add, right after `mountEcology(ctx)` runs (or
anywhere later that same tick, before anything queries `ecology`):

```ts
import { mountEcology, getMountedEcologyService } from '@ecology/index';

const disposeEcology = mountEcology(ctx);
const ecologyService = getMountedEcologyService();
if (ecologyService) registry.register('ecology', ecologyService);
```

`getMountedEcologyService()` returns the same `IEcologyQuery` instance `mountEcology` built
internally — there's exactly one live instance per mount, tracked module-locally.

### ecology dev harness routing (open question)

`src/ecology/dev/Harness.tsx` is a genuinely standalone component (per the card: "mounts ONLY
your module against Null services") that builds its own `MountContext`, its own `<Canvas>`, and
calls `mountEcology` + `markReady()` itself. But `App.tsx`/`main.tsx` are frozen and `MODULES` is
empty pre-merge, so I could not find a way for `?scene=ecology` to actually resolve to it through
the normal `npm run dev` route on this branch. I did not edit either frozen file to work around
this. Two options I can see, your call:

1. Temporarily wire `EcologyHarness` into `App.tsx`'s `Scene` for local testing on module
   branches only (revert before merge) — matches how the rest of the debug-scene convention
   reads, but you said not to touch frozen files, so I didn't do this myself.
   2. Give every module a tiny per-branch dev entry (outside the frozen set) that `vite.config.ts`
   could multi-page into — bigger change, your call whether it's worth it project-wide.

`tests/ecology/harness.spec.ts` is written assuming the routing exists and documents this
assumption inline; it should start passing the moment routing lands, with no changes needed.

### Assumptions I made about other modules' behaviour

- **`world`**: `regionsFromWorld(ctx.services.world())` is called once at mount to build the
  region roster (not cached as a live service reference — see the code comment in `index.ts`).
  If `world`'s real region list can change after mount (e.g. procedural reveal), `ecology` won't
  pick that up without a remount. Flag if that's a real requirement and I'll make it re-poll.
- **Weather**: `ecology` listens for `weather:changed` and keeps a single **global** `WeatherKind`
  (not per-region), used only by the `fire_ignition` rule's `weather` condition. If `world` emits
  per-region weather and regions can differ meaningfully, this rule will be less precise than
  intended — an easy fix once `world`'s actual event payload is real (I only have the contract
  type to go on, no live behaviour to test against).
- **Season/calendar**: `ecology` derives season and day count purely from tick count
  (`seasons.ts`), independent of `world`'s `time:phase`. If `world`'s real calendar constants
  differ from `SEASON_LENGTH_TICKS` in `seasons.data.ts`, the two will visibly disagree (e.g. a
  snowy render in what `ecology` still considers autumn). Easiest fix: either align the tick
  constants, or have `ecology` listen to `time:phase` instead — I left it tick-derived because a
  Null `world` never emits events, and standalone development needed a calendar regardless.
- **`society`**: the `economy` rule-condition kind always reads a neutral `0.5` — there's no real
  village-stress signal to read yet. None of the shipped 63 rules currently use an `economy`
  condition for this reason (the "village hostility"/"village famine" narrative beats key off
  `population`/`playerKills` conditions instead, which `ecology` can actually observe).
- **`creatures`**: `ecology` assumes `creature:died` events carry a `regionId` and a `cause` that
  is exactly `'player'` when and only when the player did it — that distinction is load-bearing
  for the whole game's premise (`pressure.ts`). If `creatures` ever emits a death without a
  region, that death is silently dropped rather than mis-attributed to whichever region `ecology`
  happens to be looking at.
- **Species/creature identity**: `ecology`'s `SpeciesId`s (`src/ecology/species.data.ts`, 24
  species) are the ones `creatures` needs to match when spawning bodies and reporting deaths —
  I couldn't coordinate on a shared species list since `creatures`' branch isn't visible to me.
  If `creatures` has already picked different ids, one of us needs to reconcile the list; happy
  to rename mine to match rather than the other way around, since mine also drives the trophic
  math (diet graph, capacities) and would need retuning either way if species disappear.

### What I could not actually run in this environment

No network access in my sandbox, so I could not `npm ci` or run `npm run verify` for real. What
I *did* verify directly:

- Every pure-logic file in `src/ecology` (everything except `dev/Harness.tsx` and
  `dev/Dashboard.tsx`, which need `react`/`@react-three/fiber` — not resolvable without `npm ci`)
  typechecks cleanly against the real `tsconfig.json` compiler options, including every test in
  `tests/ecology/` (checked against real project `tsconfig.json` settings, with local type stubs
  standing in only for the `vitest` and `@playwright/test` module declarations themselves).
- `node scripts/check-boundaries.mjs` — the real, frozen script — passes cleanly against this
  branch (no `Math.random`, no wall-clock in sim code, no cross-module imports, every file under
  400 lines).
- I could not actually execute `npm run test`, `npm run test:e2e`, or generate Playwright
  screenshots. Please run `npm run verify` for real after `npm ci` before merging — I'd
  particularly watch `tests/ecology/stability-fuzz.test.ts` (20 seeds × 500k ticks on a 4-region
  map; it's the slow one by design, 180s timeout) and `tests/ecology/cascade-wolves.test.ts`
  (asserts real rule-firing timing I tuned by reading the math, not by running it — if the
  cascade doesn't fire within the tick budgets given, the fix is almost certainly loosening a
  `sustainedFor`/`after` in `natureRules.trophic.data.ts`, not the engine itself).
