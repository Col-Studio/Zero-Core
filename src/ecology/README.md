# ecology — the cascade engine

Simulates the trophic web that makes the world remember what the player does to it: population
dynamics, vegetation, a data-driven nature-rules engine, migration, and the player-pressure
ledger. Implements `IEcologyQuery` (see `src/contracts/services.ts`).

## Public API (`src/ecology/index.ts`)

- **`mountEcology(ctx: MountContext): () => void`** — the module's `MountFn`. Builds the live
  simulation, listens for `creature:died` and `weather:changed` on the bus, and keeps the model
  advanced lazily (see "Lazy catch-up" below). Returns a disposer.
- **`getMountedEcologyService(): IEcologyQuery | null`** — for the integration lead's
  `registry.register('ecology', ...)` call. `ctx.services` is read-only, so `mountEcology` cannot
  register itself; see the header comment in `index.ts` and INTEGRATION_NOTES.md for the exact
  wiring the lead needs to add.
- **`simulateEcology(seed, ticks, scriptedKills?, regions?): HeadlessResult`** — the headless
  entry point. No ctx, no bus, no browser. Runs on a 9-region synthetic map by default (see
  `regions.ts`) and does ~100k ticks/second, which is what makes it usable as a tuning tool, not
  just a test fixture.
- `ALL_RULES`, `SPECIES`, `computeStateHash`, `serializeState`/`deserializeState`, and the core
  types (`NatureRule`, `Condition`, `Effect`) are re-exported for tooling and tests.

## Architecture

```
species.data.ts ─┐
regions.ts        ├─► population.ts ─┐
seasons.ts        │                  ├─► sim.ts (advanceOneTick) ─► state.ts (SimState)
vegetation.ts     ┘                  │        ▲
pressure.ts ──────────────────────────┘        │
rulesEngine.ts ◄── natureRules.*.data.ts        │
migration.ts ───────────────────────────────────┘
facts.ts (glue: SimState -> RegionFacts / rate multipliers)
query.ts (SimState -> IEcologyQuery)
index.ts (mountEcology, bus wiring, event throttling)
```

Everything left of `sim.ts` is a pure function operating on plain data — no bus, no service
registry, no React. `sim.ts`'s `advanceOneTick` is the only place a `SimState` is mutated.
`simulateEcology` and `mountEcology` are two different front doors onto the exact same core.

### The population model

Damped coupled-logistic growth with a saturating (type-II) predation response — Lotka-Volterra
*flavoured*, deliberately not literal Lotka-Volterra, which oscillates without bound. Every term
is clamped; see `population.data.ts` for the constants and the reasoning in its header comment.

### The nature-rules engine

`rulesEngine.ts` evaluates `NatureRule.when` against per-region facts each tick, tracks how long
the condition has held (`sustainedFor`), and after it fires, waits an additional `after` ticks
before applying `then` — that delay is what makes the world feel like it's reacting rather than
switching a value. 63 rules ship across four files:

- `natureRules.trophic.data.ts` — the card's own wolves→deer→vegetation→famine→dire-wolf chain,
  plus its lynx/cave-bear and otter/swamp-wyrm siblings.
- `natureRules.resource.data.ts` — pollinator collapse, overfishing/algal bloom, deforestation →
  erosion → flood risk (narrative only — `ecology` doesn't own terrain), fire ecology, disease.
- `natureRules.social.data.ts` — overhunting consequences, keystone silent restructuring,
  positive "protect it long enough" cascades.
- `natureRules.variants.data.ts` — the remaining predator/herbivore combinations, generated once
  at module load from small explicit tuple tables (still fully deterministic data — see its
  header comment for why this isn't hand-duplicated literals).

**What effects can't do:** `ecology` only owns population numbers and vegetation. "Economy
shift", "faction shift", and "weather bias" mentioned in the original card are conveyed only
through a fired rule's `narrative` and `severity` on `cascade:triggered` — there's no command to
mutate a village or the weather from here. `society` and `world` are expected to react to that
event themselves.

### Lazy catch-up (why there's no simulation loop)

`ecology` never owns a render loop or a `useFrame`. Instead, `mountEcology`'s `IEcologyQuery`
methods each call `ensureCaughtUp()` before answering, which advances the model tick-by-tick from
wherever it last stopped up to `ctx.getTick()`. Same tick in ⇒ same answer out, regardless of who
asked or when. It also means the dev harness doesn't need its own simulation driver — only a tick
counter — see `dev/Harness.tsx`.

### Region coupling vs. migration

Two distinct mechanisms, both card requirements: `migration.ts`'s `diffuseRegions` is a small,
continuous, every-tick flow between neighbours (so a cascade can spread across the map); a rule's
`migration` effect is a discrete, scheduled arrival after a realistic delay (`migration.data.ts`),
resolved by picking the neighbour with the largest surplus when `fromAdjacent` is set.

## Tuning knobs

All numbers live in `*.data.ts` files, never inline in logic (per CLAUDE.md). Start with
`population.data.ts` (growth/predation/damping), `vegetation.data.ts` (regrowth/fire), and
`pressure.data.ts` (how fast the world "forgets" a kill). `?scene=ecology` gives a live dashboard
for tuning by eye; `simulateEcology` is the fast/scriptable path for tuning by assertion.

## Known gaps / simplifications (see INTEGRATION_NOTES.md for the full list)

- **Season/weather source of truth.** `ecology` derives its own calendar purely from tick count
  (`seasons.ts`) rather than depending on `world`'s `time:phase`. Weather is a single global
  value updated from `weather:changed`, not per-region.
- **`economy` condition is a stub** (always 0.5, neutral) until `society` exists to report real
  village stress.
- **Dev harness routing.** `App.tsx`'s `MODULES` array is frozen and empty pre-merge, so
  `?scene=ecology` isn't reachable through the default dev server yet on this branch — see
  INTEGRATION_NOTES.md.
- **This environment had no network access**, so `npm ci` / `npm run verify` /
  Playwright screenshots could not actually be executed here. Every pure-logic file (everything
  except `dev/Harness.tsx` and `dev/Dashboard.tsx`, which need `react`/`@react-three/fiber` types
  not available in this sandbox) was typechecked directly with a local `tsc` against the real
  `tsconfig.json` compiler options, and `scripts/check-boundaries.mjs` was run for real and
  passes. See INTEGRATION_NOTES.md for what still needs a real `npm run verify` pass.
