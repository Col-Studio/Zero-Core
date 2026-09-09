/**
 * Every tuning number `core` owns, in one table. CLAUDE.md § Hard invariants 9: no magic numbers
 * in logic. When a member asks "why 5 catch-up steps?" the answer has to live somewhere findable.
 */

import { TICKS_PER_SECOND } from '@contracts/ids';

// -------------------------------------------------------------------------------------------
// Fixed-timestep loop
// -------------------------------------------------------------------------------------------

export const LOOP = {
  /** 20 Hz simulation — the contract in `@contracts/ids`. Never diverge from it. */
  tickRate: TICKS_PER_SECOND,
  /** 50 ms per simulation step. */
  stepMs: 1000 / TICKS_PER_SECOND,
  /**
   * Hard cap on simulation steps per rendered frame. Without it, a long stall (a GC pause, a
   * backgrounded tab, a breakpoint) queues more simulation than the next frame can run, which
   * makes the next frame slower still — the death spiral. At the cap we drop simulated time and
   * report it instead of trying to catch up forever.
   */
  maxCatchUpSteps: 5,
  /**
   * Frame deltas above this are treated as a stall and clamped before they reach the accumulator.
   * 250 ms = 5 steps, so a clamped frame is exactly one catch-up burst.
   */
  maxFrameMs: 250,
  /** Speeds the ecology team asked for: watch a cascade take 40 minutes, or 2.5. */
  speeds: [1, 4, 16] as const,
  /** Rolling window for the loop's own step/frame statistics. */
  statsWindow: 120,
} as const;

export type LoopSpeed = (typeof LOOP.speeds)[number];

// -------------------------------------------------------------------------------------------
// ECS
// -------------------------------------------------------------------------------------------

export const ECS = {
  /** Slots allocated up front. Grows geometrically past this; 4096 covers every debug scene. */
  initialCapacity: 4096,
  /** Growth factor when the entity pool is exhausted. */
  growthFactor: 2,
  /**
   * Component mask width in 32-bit words. Two words = 64 component types across all seven
   * modules, which is roughly 9 each. Raise it here (and only here) if the merge needs more.
   */
  maskWords: 2,
  /** Entity index bits. 20 → just over a million live entities, generation in the rest. */
  indexBits: 20,
} as const;

// -------------------------------------------------------------------------------------------
// Save / load
// -------------------------------------------------------------------------------------------

export const SAVE = {
  /** Bump on every breaking format change and add a migration. Versioned from day one. */
  version: 2,
  dbName: 'world-zero',
  storeName: 'saves',
  /** Slot used by the autosave timer. Manual saves use their own labels. */
  autosaveSlot: 'autosave',
  /**
   * Autosave cadence in SIMULATION ticks, not wall-clock ms: 600 ticks = 30 simulated seconds.
   * Wall-clock would make the save point depend on frame rate, and a replay recorded on a fast
   * machine would autosave at a different tick than the same session on a slow one.
   */
  autosaveIntervalTicks: 30 * TICKS_PER_SECOND,
} as const;

// -------------------------------------------------------------------------------------------
// Perf budget — per-module frame-time allowance at 60 fps
// -------------------------------------------------------------------------------------------

/**
 * 16.6 ms total. These are the numbers the post-merge regression hunt is judged against: when
 * frame time doubles after a merge, the report says which module spent it.
 */
export const PERF = {
  frameBudgetMs: 16.6,
  /** Samples kept per label. 240 frames = 4 s at 60 fps. */
  window: 240,
  budgets: {
    core: 1.5,
    /** The whole scheduler pass, which is what `core` is actually accountable for. */
    'core.step': 1.5,
    world: 3.5,
    ecology: 1.0,
    creatures: 3.5,
    player: 2.0,
    society: 1.0,
    presentation: 3.0,
  } as Record<string, number>,
} as const;

// -------------------------------------------------------------------------------------------
// Debug scenes
// -------------------------------------------------------------------------------------------

export const SCENES = {
  /** `?scene=core` — the 10 000-entity stress test the card requires. */
  stressEntities: 10_000,
  stressFieldRadius: 90,
  stressSpeed: 2.2,
  /** `?scene=loop` — timestep visualiser. Bars for the last N frames. */
  loopHistory: 90,
  /** Marchers in the timestep visualiser: few, large, and easy to compare frame by frame. */
  loopEntities: 24,
  /** `?scene=save` — round-trip proof. Entities in the toy world being saved and reloaded. */
  saveEntities: 240,
  /** No `?scene=` — a calm ambient shoal, so the shell is never an empty grey plane. */
  defaultEntities: 600,
  /**
   * Overlay refresh rate in Hz. Deliberately not 60: the overlay is React, the simulation is
   * typed arrays, and re-rendering React at frame rate would make the perf panel the slowest
   * thing being measured.
   */
  overlayHz: 4,
} as const;
