# WORLD ZERO

**A world that remembers what you did to it.**

A procedurally generated, stylized low-poly 3D world with villages, creatures, ruins, weather,
factions and a living ecosystem — built in the browser with three.js on WebGL2.

The premise: the world does not reset. It accumulates. Kill the wolves harassing a village and
you have solved today's problem and started a chain you cannot take back.

```
             kill every wolf in the valley
                        │
             deer population ↑↑
                        │
             vegetation overgrazed ↓
                        │
             food shortage → village economy collapses
                        │
             farmers become hunters
                        │
             a harder predator migrates into the empty niche
```

Sixty-plus **nature rules** like that one, chained, delayed, and data-driven, so the world
tells a different story every run. Played first-person, with adventure guilds handing out
missions generated from what is *actually happening* in the simulation, four switchable
fighting styles, and three multi-phase boss fights against corrupted apex predators.

---

## Stack — fixed, do not substitute

| Decision | Choice | Why |
|---|---|---|
| Renderer | three.js `WebGLRenderer`, **WebGL2** | Deepest model + community knowledge. **No `WebGPURenderer`, no TSL** — too new, hallucination-prone. |
| Scene layer | **React Three Fiber v9 + `drei`** | Declarative JSX: 7 people edit 7 component trees without collision. `drei` erases boilerplate. |
| Language | **TypeScript, strict** | Our hallucination detector. Invented API → compile error, not a silent runtime bug. |
| Physics | **`@react-three/rapier`** | WASM, deterministic, well documented. Never hand-roll collision. |
| Post-processing | **pmndrs `postprocessing`** | Bloom + SMAA + vignette + mild aberration = most of the production look. |
| Audio | **Tone.js**, procedural | Zero asset pipeline. |
| State | **zustand** | Minimal, testable, no boilerplate. |
| Build | **Vite 6** | Instant HMR; fast iteration is the whole point. |
| Tests | **Vitest** (logic) + **Playwright** (visual/E2E) | Screenshot loop is how we art-direct. |
| Art | **CC0 GLTF** — Kenney, Quaternius, Poly.pizza | We never author 3D art. |

**Visual target:** low-poly + volumetric fog + stylized water + dynamic sky + particles + soft
cascading shadows. Never photorealism.

---

## Architecture — how 7 isolated agents ship one game

Seven members, seven branches, seven AI sandboxes that cannot see each other. Five rules make
that merge cleanly instead of catastrophically.

1. **Frozen contracts package.** `src/contracts/` holds every shared type, event, and service
   interface. Written once, then frozen. Byte-identical in all 7 branches — identical files
   cannot conflict.
2. **Nobody imports anybody.** No module may import another member's folder. Cross-module
   communication is *only* the typed event bus. This is the rule that makes merges trivial.
3. **Null Object placeholders.** `contracts/nulls.ts` ships a deterministic fake for every
   service. Each sandbox injects Nulls for the six modules it does not own, so **every branch
   runs standalone from hour one**. At merge, real services replace Nulls in one file.
4. **Exclusive file ownership.** You create files only inside your own folder. Two people never
   touch one file.
5. **One mount function per module.** `mountWorld(ctx)`, `mountEcology(ctx)`, … The shell calls
   all seven. `App.tsx` is the only integration surface in the repo.

### Ownership map

| Branch | Folder | Owns | Implements |
|---|---|---|---|
| `core` | `src/core/` | Contracts, ECS, fixed-timestep loop, save/load, CI, tooling | *(authors the contracts)* |
| `world` | `src/world/` | Terrain, biomes, regions, rivers, resources, ruins, weather state | `IWorldQuery` |
| `ecology` | `src/ecology/` | Populations, trophic web, **nature rules engine**, player-pressure memory | `IEcologyQuery` |
| `creatures` | `src/creatures/` | Utility AI, herds, packs, animation, **boss fights** | `ICreatureQuery` |
| `player` | `src/player/` | FPS controller, combat, **4 fighting styles**, inventory | `IPlayerQuery` |
| `society` | `src/society/` | Villages, economies, factions, **guilds & mission generation** | `ISocietyQuery` |
| `presentation` | `src/presentation/` | Sky, water, weather VFX, shaders, post FX, HUD, **chronicle**, audio | `IPresentation` |

### Frozen — integration lead only

`src/contracts/**` · `src/main.tsx` · `src/App.tsx` · `vite.config.ts` · `tsconfig.json` ·
`package.json` · `CLAUDE.md` · `.github/**`

If a contract looks wrong, do not edit it — write the concern in your `INTEGRATION_NOTES.md`.

---

## Timeline

- **Days 0–2 — blocking prologue.** Member 1 alone ships the contracts package. Nobody else
  writes code; they read their card, install the stack, and design.
- **Day 3 → end — flat parallel.** All 7 work simultaneously against Null services. No member
  ever waits for another.
- **Merge** in order: `core → world → ecology → creatures → society → player → presentation`.
  Each PR green on CI before the next lands. Then swap Nulls for real services one at a time.

---

## Commands

```bash
npm install
npm run dev          # Vite dev server → http://localhost:5173
npm run typecheck    # tsc --noEmit — must be 0 errors
npm run test         # Vitest unit tests
npm run test:e2e     # Playwright specs
npm run shot         # deterministic screenshot of a debug scene
npm run boundaries   # cross-module imports, Math.random(), frozen-file guard
npm run verify       # everything above — run before every PR
```

### Debug URLs

Every module ships debug scenes behind URL params, always deterministic:

```
?seed=42&scene=terrain&tick=2000&freeze=1
```

`?seed` seeds all randomness · `?scene` selects a module's debug scene · `?tick` fast-forwards
the simulation · `?freeze=1` pins camera and time for screenshot comparison.

---

## Non-negotiable invariants

1. 1 unit = 1 meter. Y-up, right-handed, meshes face `-Z`.
2. **No `Math.random()` anywhere** — only `rng` from `@contracts/rng`. CI-enforced.
3. No `Date.now()` / `performance.now()` in simulation code. Use the injected tick.
4. Fixed timestep: simulation 20 Hz, rendering decoupled.
5. Never import another member's folder. Events only.
6. Never edit frozen files.
7. Every file under 400 lines.
8. All tuning numbers live in `*.data.ts` tables, never inline.
9. Same seed + same tick ⇒ identical state hash and a visually identical frame.

See `CLAUDE.md` for the full set that every AI agent on the project reads.

---

## The acceptance test that defines "done"

Fresh seed. Script a player killing every wolf in one region. Fast-forward 20 minutes of
simulation. Assert the whole chain end to end:

> deer boom → vegetation collapse → village economy shift → new predator migrates in →
> a guild mission is generated about it → a chronicle entry renders it back to the player

If that passes, the game exists.
