# core — the engine spine

The minimal numeric ECS, the fixed-timestep loop, save/replay, the reference simulation, the perf
budget harness, and the dev tooling. Everything here is deterministic by construction: no wall
clock, no `Math.random`, no third-party ECS. The other six modules never import any of this —
they see the engine only through `@contracts` and the event bus (enforced by
`npm run boundaries`).

## Layout

```
src/core/
├── core.data.ts      All tuning constants in one place (loop, ecs, save, perf, scenes)
├── runtime.ts        The CoreRuntime singleton: world + scheduler + loop + saves + perf
├── index.ts          Public API — mountCore(ctx) plus the re-exported primitives
├── ecs/
│   ├── entity.ts     Numeric ids, generation recycling, EntityManager (SoA alive/generations)
│   ├── world.ts      EcsWorld: components, masks, queries, snapshot/restore/hash
│   ├── store.ts      soa() typed-array stores and objects() row stores
│   └── system.ts     System { name, order, update }, SystemScheduler
├── loop/
│   ├── fixedLoop.ts  20 Hz accumulator, interpolation alpha, pause/step/speed, catch-up cap
│   └── driver.ts     rAF driver — passes timestamps through, never reads a clock
├── save/
│   ├── format.ts     Versioned envelope, structural validation, v1→v2 migration
│   ├── snapshot.ts   SnapshotSource: world + per-module capture/restore, content hash
│   ├── store.ts      IndexedDB store + memory store (tests)
│   ├── manager.ts    Save/load/autosave, seed guard, hash verification
│   └── replay.ts     Input-event recorder + deterministic replay
├── perf/
│   ├── budget.ts     Rolling samples, mean/p95/max, per-label budgets, report()
│   └── now.ts        The one approved performance.now() wrapper (outside simulation)
├── sim/              The reference simulation: 10 000 drifting creatures — test load, not gameplay
└── dev/              Dev overlay, debug scenes (?scene=core|loop|save), standalone Harness
```

## Public API

`mountCore(ctx)` is the shell's entry point; everything else is exported for tests and tooling
through `@core/index`:

- **ECS** — `EcsWorld` (`spawn`, `destroy`, `defineComponent`, `query({ all, none })`, `set`,
  `get`, `snapshot`, `restore`, `hash`), `soa`/`objects` stores, `SystemScheduler`,
  `defineSystem`.
- **Loop** — `createFixedLoop` (`advance(nowMs)`, `frame`, `runTicks`, `pause/resume/stepOnce`,
  `setSpeed(1|4|16)`, `alpha`, `stats`), `createLoopDriver`.
- **Save** — `createSaveManager` (`save`, `load`, `onTick` autosave, `verifyRoundTrip`),
  `createSaveStore`/`createMemorySaveStore`, `createRecorder`/`replay`, `migrate`, `looksLikeSave`.
- **Perf** — `createPerfBudget` (`begin/end(label)`, `frame`, `report`), `formatReport`.

### Entity ids

An `EntityId` packs `(index, generation)` — `entityIndex`/`entityGeneration` unpack it. Destroyed
slots are recycled with a bumped generation, so a stale id can never address a newer occupant.
Capacity grows by `ECS.growthFactor` from `ECS.initialCapacity`; `reserve()` only ever grows.

### Snapshot and restore semantics

`world.snapshot()` captures `(used, entities, masks, components)`. `world.restore(snapshot)`
reserves the saved entity-pool capacity (growing in lockstep with the entity manager, never
shrinking), resets every store, then restores rows. Component definitions are not serialized —
the restoring build must define the same components; unknown names in a save are reported in
`restore()`'s `ignored` list instead of throwing. `world.hash()` is a deterministic structural
hash of live rows only — capacity and padding never affect it, so `save → load → hash` is the
round-trip proof the card asks for.

## Tuning knobs (`core.data.ts`)

| Constant | Default | Meaning |
|---|---|---|
| `LOOP.tickRate` | 20 Hz | Simulation rate; render is decoupled |
| `LOOP.maxCatchUpSteps` | 5 | Death-spiral cap: steps per frame, rest is dropped |
| `LOOP.maxFrameMs` | 250 | Frame clamp applied before accumulation |
| `ECS.initialCapacity` | 4096 | Starting entity pool |
| `ECS.growthFactor` | 2 | Pool growth multiple |
| `SAVE.autosaveTicks` | 600 | Autosave interval (30 s at 20 Hz) |
| `SAVE.version` | 2 | Envelope version; v1 saves migrate forward |

## Invariants the tests enforce

- 10 000 entities at 20 Hz — iteration over the full population stays in the sub-2 ms range
  (`ecs.test.ts` hot path); the stress scene holds its budget with the sim under ~1 ms/step.
- `save → load → hash` equals the pre-save hash, including entity generations, the free list,
  and per-module blobs (`save.test.ts`).
- Replay from a recorded event log reproduces identical state and tick (`save.test.ts`).
- A 2 s stall runs at most `maxCatchUpSteps`, drops the rest into `stats().droppedMs`, and
  recovers to 1 step on the next frame — never a death spiral (`loop.test.ts`).
- A save from a different seed is refused (`seed-mismatch`), a corrupted save is refused by
  content hash (`hash-mismatch`), and future versions are refused with a clear reason.

## Browser verification

`npx playwright test tests/e2e/core.spec.ts` covers all three debug scenes
(`?scene=core|loop&seed=42&tick=120&freeze=1`): each boots to `__READY__` with a silent console,
and the frozen stress scene renders byte-identical PNGs across reloads. Screenshots via
`node scripts/shot.mjs --scene=core,loop,save`.

Measured under software WebGL (swiftshader), 10 000-entity scene: simulation step p95 ≈ 0.8 ms
against a 1.2 ms budget; total frame p95 is dominated by software rasterization and is not
representative of hardware GL. On real GPUs the scene is fill-rate-light and the sim dominates.

## Known gaps / deliberate limits

- Queries are full-mask scans — no archetype tables. Fine at 10 k entities; revisit past ~100 k.
- `objects()` stores snapshot by structured clone; large object components are on the caller.
- Replay records input events only, not per-tick state; determinism of the sim is what makes
  that sound. Any system that reads wall-clock breaks replay — the boundary check guards this.
- The reference sim is a load generator and integration fixture, not gameplay.
