/**
 * The one place in `src/core/` allowed to read a wall clock.
 *
 * CLAUDE.md § Hard invariants 3 bans `performance.now()` in simulation code, and rightly: a
 * simulation that can see real time is a simulation that cannot be replayed. Measurement,
 * however, has to see real time — so it is quarantined here, in a module that returns a number
 * nothing in the simulation is allowed to read.
 *
 * The rule for reviewers is simple: `now()` may be imported by `perf/` and by the dev overlay.
 * If it ever appears in a system, a component, or anything that touches ECS state, that is a
 * determinism bug regardless of how harmless it looks.
 */

/** Monotonic milliseconds, with a Date fallback for environments without `performance`. */
export const now: () => number =
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? () => performance.now() // allow-boundary: measurement only, never read by simulation code
    : () => Date.now(); // allow-boundary: measurement fallback for non-browser hosts
