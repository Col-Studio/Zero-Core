
---

# PHASE 2 HANDOFF — core engine spine

**From:** core (Member 1) · **To:** Members 2–7 · **Branch:** `core`

The engine spine is in: ECS, fixed loop, save/replay, reference sim, perf harness, dev overlay,
and the three debug scenes. **Full API and tuning knobs: `src/core/README.md` — read it before
you scaffold your module.** The short version of what changed for you:

## What you now have

- **`mountCore(ctx)`** runs on shell boot and starts the 20 Hz simulation. Your module mounts
  after core in `App.tsx`'s `MODULES` list; read the tick through `ctx.getTick()`.
- **The tick is the only clock.** `bus.setTick()` is stamped once per step before systems run.
  Never call `Date.now()`/`performance.now()` in simulation code — the boundary check fails the
  build (dev files and `presentation` are exempt).
- **Events are your seam.** Emit/subscribe through the bus; the recorder logs inputs for replay.
- **Autosave** runs every 600 ticks (30 s) to IndexedDB. Register your module state with the
  snapshot source (see `runtime.ts`): `snapshots.register({ id: 'yourModule', capture, restore })`
  — capture/restore must return/accept plain cloneable data, and unknown keys from newer saves
  are preserved as orphan blobs, never dropped.

## Verified on this branch

| Gate | Result |
|---|---|
| `npm run typecheck` | 0 errors |
| `npm run boundaries` | clean, 56 files checked |
| `npm run test` | **169 passing**, 10 files |
| `npm run test:e2e` | **9 passing** — 5 shell + 4 core (all three debug scenes, byte-identical frozen frames) |
| Determinism | save→load→hash equality, replay equality, and identical-PNG assertions all green |
| Screenshots | `?scene=core\|loop\|save` captured at seed 42, tick 120, frozen — overlay fully live |

## Rules that will bite you (learned the hard way in Phase 2)

1. **Restore reserves the saved pool, nothing more.** `EcsWorld.restore` grows to the saved
   capacity only; `hash()` deliberately ignores capacity. Don't "fix" a capacity mismatch by
   reserving `initialCapacity` — it changes nothing about state but breaks nothing either; the
   hash is over live rows, which is the property saves rely on.
2. **Register your snapshot module before the first autosave**, or a mid-session save will
   silently miss your state (it round-trips as an orphan blob, so nothing is lost — but a
   reload won't restore you).
3. **Read the runtime through the hook** (`useCoreRuntime`) — the shell mounts modules inside
   the Canvas's render pass, which can land after your first render. The hook polls until the
   singleton exists; don't cache it in a module-level variable.
4. **Import `@core/ecs/world` by alias, never by relative path** — the boundary checker treats
   any relative path containing a `world` segment as a cross-module violation.
5. **Loop tests: feed timestamps, multiply don't accumulate** — repeated float additions drift
   (59 vs 60 ticks in 3 s), multiplicative timestamps don't.

## Measured performance (swiftshader, software GL — hardware numbers will be better)

- 10 000-entity stress scene: sim step p95 ≈ 0.8 ms (budget 1.2 ms); `core.motion` ≈ 0.6 ms.
- Save round-trip of the 10 k world: ~1–2 ms capture+restore, envelope in the low hundreds of kB.
