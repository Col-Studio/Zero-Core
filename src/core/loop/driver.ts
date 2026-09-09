/**
 * The browser driver for the fixed loop.
 *
 * Separated from `fixedLoop.ts` so the loop itself has no DOM dependency and can be tested in
 * plain Node. The driver's only job is to turn `requestAnimationFrame` into `loop.frame(t)`.
 *
 * Note what is NOT here: a call to `performance.now()`. rAF already hands the callback a
 * high-resolution timestamp, so simulation time enters the system through exactly one door.
 * CLAUDE.md § Hard invariants 3 bans wall-clock reads in simulation code, and the cheapest way
 * to obey a rule is to have no place left to break it.
 */

import type { FixedLoop } from './fixedLoop';

export interface LoopDriver {
  start(): void;
  stop(): void;
  running(): boolean;
}

export interface DriverOptions {
  /** Injectable for tests; defaults to the browser's rAF. */
  requestFrame?: (cb: (timeMs: number) => void) => number;
  cancelFrame?: (handle: number) => void;
  /** Called after every frame, for the overlay and the perf harness. */
  onFrame?: (timeMs: number, stepsRun: number) => void;
}

export function createLoopDriver(loop: FixedLoop, options: DriverOptions = {}): LoopDriver {
  const requestFrame =
    options.requestFrame ??
    ((cb: (timeMs: number) => void): number =>
      typeof requestAnimationFrame === 'function' ? requestAnimationFrame(cb) : 0);
  const cancelFrame =
    options.cancelFrame ??
    ((handle: number): void => {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(handle);
    });

  let handle: number | null = null;

  const onFrame = (timeMs: number): void => {
    // Schedule the next frame first: if the step below throws, the loop still recovers next
    // frame instead of the whole game silently stopping.
    handle = requestFrame(onFrame);
    const ran = loop.frame(timeMs);
    options.onFrame?.(timeMs, ran);
  };

  return {
    start() {
      if (handle !== null) return;
      handle = requestFrame(onFrame);
    },
    stop() {
      if (handle === null) return;
      cancelFrame(handle);
      handle = null;
    },
    running: () => handle !== null,
  };
}
