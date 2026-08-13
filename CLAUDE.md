# CLAUDE.md — WORLD ZERO

Every AI agent working in this repository reads this file. It is the project's constitution.
If anything you are about to write conflicts with this file, this file wins.

---

## What this project is

A browser 3D game: a stylized low-poly world with a living ecosystem that **remembers what the
player did to it**. Killing creatures triggers delayed, chained ecological cascades — kill the
wolves, the deer boom, the vegetation collapses, a village starves, a worse predator moves in.
First-person, with adventure guilds, procedurally generated missions, four fighting styles, and
boss fights. See `README.md` for the full pitch and architecture.

---

## Stack — never substitute

| Layer | Choice |
|---|---|
| Renderer | three.js `WebGLRenderer`, **WebGL2 only** |
| Scene | React Three Fiber v9 + `@react-three/drei` |
| Language | TypeScript, `strict` |
| Physics | `@react-three/rapier` |
| Post FX | `@react-three/postprocessing` (pmndrs) |
| Audio | Tone.js, procedural only |
| State | zustand |
| Build | Vite 6 |
| Tests | Vitest (logic) + Playwright (visual/E2E) |
| Art | CC0 GLTF (Kenney, Quaternius, Poly.pizza) or procedural |

**Never** use `WebGPURenderer`. **Never** use TSL / node materials. Shaders are WebGL2 GLSL.
Never hand-roll collision — Rapier only. Never author 3D art. Never ship audio files.

---

## Hard invariants

1. **Units.** 1 unit = 1 meter. Y-up, right-handed. Meshes face `-Z`.
2. **No `Math.random()` anywhere.** Only `rng` from `@contracts/rng`. CI greps for this.
3. **No `Date.now()` / `performance.now()` in simulation code.** Use the injected tick count.
   (Presentation-only timing is the sole exception, and must not affect sim state.)
4. **Fixed timestep.** Simulation 20 Hz with an accumulator; rendering decoupled. Never
   simulate inside `useFrame`.
5. **No cross-module imports.** A module may import only from `@contracts/*` and its own
   folder. All cross-module communication goes through the typed event bus.
6. **Never edit frozen files** (list below). If a contract is wrong, stop and write the concern
   in your `INTEGRATION_NOTES.md`.
7. **Create files only inside your assigned folder** and `tests/<your-folder>/`.
8. **Every file under 400 lines.** Split aggressively — small files mean small context and
   better output.
9. **All tuning numbers in `*.data.ts` tables**, never inline in logic.
10. **Determinism.** Same seed + same tick ⇒ identical state hash and a visually identical
    frame, on any machine.
11. Never allocate inside the render loop. Pool everything hot.

---

## Frozen files — integration lead only

```
src/contracts/**      src/main.tsx     src/App.tsx
vite.config.ts        tsconfig.json    package.json
playwright.config.ts  vitest.config.ts CLAUDE.md
.github/**
```

These are byte-identical across all 7 branches. That is *why* the branches merge cleanly.

---

## Module ownership

| Branch | Folder | Implements | Import alias |
|---|---|---|---|
| `core` | `src/core/` | *(authors contracts)* | `@core/*` |
| `world` | `src/world/` | `IWorldQuery` | `@world/*` |
| `ecology` | `src/ecology/` | `IEcologyQuery` | `@ecology/*` |
| `creatures` | `src/creatures/` | `ICreatureQuery` | `@creatures/*` |
| `player` | `src/player/` | `IPlayerQuery` | `@player/*` |
| `society` | `src/society/` | `ISocietyQuery` | `@society/*` |
| `presentation` | `src/presentation/` | `IPresentation` | `@presentation/*` |

You implement **one** interface. For the other six, inject the **Null implementation** from
`@contracts/nulls`. Your module must run standalone against Nulls with zero errors — that is
how seven isolated agents avoid blocking each other. Never wait on another module.

---

## Contracts package

```
src/contracts/
  ids.ts        branded ids: SpeciesId, RegionId, VillageId, MissionId, EntityId
  rng.ts        createRng(seed) → { next, int, pick, gauss }; hashState(obj)
  events.ts     GameEvent discriminated union + typed bus (emit/on/off) + event log
  services.ts   IWorldQuery IEcologyQuery ICreatureQuery IPlayerQuery ISocietyQuery IPresentation
  nulls.ts      deterministic fake for every service
  registry.ts   ServiceRegistry — DI container, defaults to Nulls
```

Each module exports exactly one mount function: `mountWorld(ctx)`, `mountEcology(ctx)`, etc.
Do not create your own `<Canvas>` — you receive the scene context. The only exception is your
standalone dev harness.

---

## Debug scenes and the screenshot loop

Every module must support:

```
?seed=42&scene=<yourDebugScene>&tick=<n>&freeze=1
```

`freeze=1` pins camera and time so screenshots are comparable. Set `window.__READY__ = true`
when your scene has finished loading — the screenshot harness waits on it.

Build a standalone harness at `src/<your-folder>/dev/Harness.tsx` that mounts only your module
against Null services.

**Use Playwright on yourself.** Load your harness, screenshot it, *look at the image*, fix what
looks wrong, repeat. Iterate until it looks good, not until it compiles. A module that compiles
but was never visually inspected is incomplete work.

---

## Definition of done

```
[ ] npm run typecheck     → 0 errors
[ ] npm run boundaries    → clean
[ ] npm run test          → passing, ≥80% coverage of your logic
[ ] npm run test:e2e      → passing
[ ] Playwright screenshots of every debug scene at fixed seed, attached
[ ] Determinism test: same seed twice ⇒ identical state hash
[ ] 60 fps in your debug scenes; state your measured frame time
[ ] README.md in your folder: what you built, public API, tuning knobs, known gaps
[ ] INTEGRATION_NOTES.md: what the integration lead must know, and every assumption you
    made about another module's behavior
```

`npm run verify` runs the automated half. Run it before every PR.

---

## Git

Work on your own branch, small commits, never commit to `main`. Merge order is
`core → world → ecology → creatures → society → player → presentation`.
