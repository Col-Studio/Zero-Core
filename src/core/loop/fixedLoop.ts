/**
 * The fixed-timestep loop — CLAUDE.md § Hard invariants 4.
 *
 * Simulation runs at exactly 20 Hz with an accumulator; rendering runs as fast as the browser
 * will draw and interpolates with `alpha`. Nothing in here reads a clock: `advance(nowMs)` is
 * handed the timestamp, which is what makes the whole thing unit-testable at any frame rate and
 * keeps `performance.now()` out of simulation code entirely (the driver passes the
 * `requestAnimationFrame` timestamp, so there is no wall-clock call anywhere in this module).
 *
 * ## Why the catch-up cap matters
 *
 * A 2 s stall queues 40 simulation steps. Running all 40 in one frame makes that frame ~40×
 * heavier, which stalls again, which queues more — the death spiral, and the classic way a
 * browser game becomes permanently unresponsive after a single GC pause. We run at most
 * `maxCatchUpSteps` and *drop* the rest of the simulated time, reporting it in `stats().dropped`.
 * Simulated time is allowed to fall behind wall-clock time; the simulation is never allowed to
 * fall behind itself.
 */

import type { Tick } from '@contracts/ids';
import { LOOP, type LoopSpeed } from '../core.data';

export interface FixedLoopOptions {
  /** Simulate one step. Receives the tick that is being simulated (pre-increment). */
  onStep: (tick: Tick, dt: number) => void;
  /** Draw. `alpha` is 0..1 between the last simulated step and the next one. */
  onRender?: (alpha: number, tick: Tick) => void;
  /** Called whenever the tick changes, after all steps in a frame. Cheap observers only. */
  onTick?: (tick: Tick) => void;
  stepMs?: number;
  maxCatchUpSteps?: number;
  maxFrameMs?: number;
  startTick?: Tick;
  startPaused?: boolean;
}

export interface LoopStats {
  /** Steps simulated since construction. */
  steps: number;
  /** Frames driven since construction. */
  frames: number;
  /** Simulated milliseconds thrown away by the catch-up cap. The death-spiral counter. */
  droppedMs: number;
  /** How many frames hit the catch-up cap. Non-zero after a stall is normal; growing is not. */
  catchUpFrames: number;
  /** Steps executed in the most recent frame. */
  lastSteps: number;
  /** Wall-clock delta of the most recent frame, after clamping. */
  lastFrameMs: number;
  /** Mean frame delta over the rolling window. */
  avgFrameMs: number;
  /** Frames per second implied by `avgFrameMs`. */
  fps: number;
}

export interface FixedLoop {
  /** Feed a timestamp. Runs zero or more simulation steps. Returns how many ran. */
  advance(nowMs: number): number;
  /** `advance` plus the render callback. This is what the rAF driver calls. */
  frame(nowMs: number): number;
  /** Simulate `n` steps immediately, ignoring wall-clock. Used for `?tick=` fast-forward. */
  runTicks(n: number): void;
  tick(): Tick;
  alpha(): number;
  paused(): boolean;
  pause(): void;
  resume(): void;
  togglePause(): void;
  /** Advance exactly `n` steps while paused — the single-step debugger. */
  stepOnce(n?: number): void;
  speed(): LoopSpeed;
  setSpeed(speed: LoopSpeed): void;
  /** Cycle 1× → 4× → 16× → 1×. The overlay button. */
  cycleSpeed(): LoopSpeed;
  stats(): LoopStats;
  /** Reset accumulator and counters, optionally to a specific tick. */
  reset(tick?: Tick): void;
}

export function createFixedLoop(options: FixedLoopOptions): FixedLoop {
  const stepMs = options.stepMs ?? LOOP.stepMs;
  const maxCatchUpSteps = options.maxCatchUpSteps ?? LOOP.maxCatchUpSteps;
  const maxFrameMs = options.maxFrameMs ?? LOOP.maxFrameMs;
  const dt = stepMs / 1000;

  let tick: Tick = options.startTick ?? 0;
  let accumulator = 0;
  let lastNow: number | null = null;
  let paused = options.startPaused ?? false;
  let speed: LoopSpeed = 1;
  let pendingSteps = 0;

  let steps = 0;
  let frames = 0;
  let droppedMs = 0;
  let catchUpFrames = 0;
  let lastSteps = 0;
  let lastFrameMs = 0;

  const frameWindow: number[] = [];

  const runStep = (): void => {
    options.onStep(tick, dt);
    tick++;
    steps++;
  };

  const loop: FixedLoop = {
    advance(nowMs) {
      // First frame establishes the baseline; a delta from "never" is meaningless.
      if (lastNow === null) {
        lastNow = nowMs;
        return 0;
      }

      const raw = nowMs - lastNow;
      lastNow = nowMs;
      frames++;

      // Negative deltas happen when a clock is adjusted mid-session. Treat as zero, never as a
      // rewind — a rewound accumulator would replay ticks and desync the simulation.
      const frameMs = Math.min(Math.max(raw, 0), maxFrameMs);
      lastFrameMs = frameMs;
      frameWindow.push(frameMs);
      if (frameWindow.length > LOOP.statsWindow) frameWindow.shift();

      let ran = 0;

      if (paused) {
        // While paused only explicit single-steps advance time.
        while (pendingSteps > 0) {
          pendingSteps--;
          runStep();
          ran++;
        }
        accumulator = 0;
        lastSteps = ran;
        return ran;
      }

      accumulator += frameMs * speed;

      while (accumulator >= stepMs && ran < maxCatchUpSteps) {
        accumulator -= stepMs;
        runStep();
        ran++;
      }

      if (accumulator >= stepMs) {
        // Hit the cap with time left over: drop it rather than compound it into the next frame.
        catchUpFrames++;
        droppedMs += accumulator;
        accumulator = 0;
      }

      lastSteps = ran;
      if (ran > 0) options.onTick?.(tick);
      return ran;
    },

    frame(nowMs) {
      const ran = loop.advance(nowMs);
      options.onRender?.(loop.alpha(), tick);
      return ran;
    },

    runTicks(n) {
      const total = Math.max(0, Math.trunc(n));
      for (let i = 0; i < total; i++) runStep();
      if (total > 0) options.onTick?.(tick);
    },

    tick: () => tick,

    // Interpolation factor for renderers. Clamped: a partially consumed accumulator can never
    // exceed one step, but a dropped-time frame could leave it at exactly stepMs.
    alpha: () => (paused ? 0 : Math.min(1, accumulator / stepMs)),

    paused: () => paused,

    pause() {
      paused = true;
      accumulator = 0;
    },

    resume() {
      paused = false;
      accumulator = 0;
    },

    togglePause() {
      if (paused) loop.resume();
      else loop.pause();
    },

    stepOnce(n = 1) {
      pendingSteps += Math.max(1, Math.trunc(n));
      if (!paused) loop.pause();
    },

    speed: () => speed,

    setSpeed(next) {
      speed = next;
      // Drop the partial step so a speed change never replays or skips one.
      accumulator = 0;
    },

    cycleSpeed() {
      const index = LOOP.speeds.indexOf(speed);
      speed = LOOP.speeds[(index + 1) % LOOP.speeds.length]!;
      accumulator = 0;
      return speed;
    },

    stats() {
      const avg =
        frameWindow.length === 0
          ? 0
          : frameWindow.reduce((a, b) => a + b, 0) / frameWindow.length;
      return {
        steps,
        frames,
        droppedMs,
        catchUpFrames,
        lastSteps,
        lastFrameMs,
        avgFrameMs: avg,
        fps: avg > 0 ? 1000 / avg : 0,
      };
    },

    reset(nextTick) {
      tick = nextTick ?? 0;
      accumulator = 0;
      lastNow = null;
      pendingSteps = 0;
      steps = 0;
      frames = 0;
      droppedMs = 0;
      catchUpFrames = 0;
      lastSteps = 0;
      lastFrameMs = 0;
      frameWindow.length = 0;
    },
  };

  return loop;
}
