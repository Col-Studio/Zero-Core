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

**Playwright's CDN is geo-blocked in our region** (403 on `npx playwright install`). Workaround:
point `PW_CHROMIUM_PATH` at any local Chromium/Chrome binary. Mine:
`~/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe`. CI is unaffected — leave it
unset there, since the pinned browser is what makes screenshots comparable.

---

## If a contract is wrong

Do **not** edit `src/contracts/**`. Write it in your `INTEGRATION_NOTES.md` and tell me. I amend
it for all seven branches at once. Divergent contracts are the single thing that breaks this
architecture — one member's local fix becomes everyone's merge conflict.
