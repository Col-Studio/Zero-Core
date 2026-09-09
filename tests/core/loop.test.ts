/**
 * Fixed-loop tests. The properties under test are the ones the card names:
 *   • 20 Hz with an accumulator, render decoupled
 *   • the loop NEVER death-spirals under a stall — time is dropped, frame time is not
 *   • pause / step / speed controls
 *   • interpolation alpha
 *
 * Every test drives the loop with explicit timestamps: no clocks, no waiting, no flakes.
 */

import { describe, expect, it } from 'vitest';
import { createFixedLoop, type FixedLoop } from '@core/loop/fixedLoop';
import { LOOP } from '@core/core.data';

const STEP = LOOP.stepMs; // 50 ms

function makeLoop(overrides: Partial<Parameters<typeof createFixedLoop>[0]> = {}): {
  loop: FixedLoop;
  ticks: number[];
  renders: { alpha: number; tick: number }[];
} {
  const ticks: number[] = [];
  const renders: { alpha: number; tick: number }[] = [];
  const loop = createFixedLoop({
    onStep: (tick) => ticks.push(tick),
    onRender: (alpha, tick) => renders.push({ alpha, tick }),
    ...overrides,
  });
  return { loop, ticks, renders };
}

describe('accumulator', () => {
  it('runs one step per 50 ms of wall time on average', () => {
    const { loop, ticks } = makeLoop();
    loop.advance(0);
    // Ten 60 fps frames = 166.7 ms = 3.33 steps → 3 run, 0.33 carries.
    let now = 16.67;
    for (let i = 0; i < 10; i++) {
      loop.advance(now);
      now += 16.67;
    }
    expect(ticks).toHaveLength(3);
  });

  it('carries a partial step in the accumulator instead of losing it', () => {
    const { loop, ticks } = makeLoop();
    loop.advance(0);
    loop.advance(25); // half a step — nothing runs
    expect(ticks).toHaveLength(0);
    loop.advance(50); // 25 + 50 = 75 ms = 1.5 steps
    expect(ticks).toHaveLength(1);
  });

  it('is stable at 20 Hz regardless of frame rate', () => {
    const stepped = makeLoop();
    stepped.loop.advance(0);
    // Multiply for the timestamp (never accumulate frame deltas) so 360 frames land on
    // exactly 3000 ms — 60 steps, no floating-point drift.
    for (let i = 1; i <= 360; i++) stepped.loop.advance((i * 25) / 3); // 120 fps
    const slow = makeLoop();
    slow.loop.advance(0);
    for (let now = 100; now <= 3000; now += 100) slow.loop.advance(now); // 10 fps

    // Both simulate the same 3 s. 100 ms frames are below both the frame clamp and the
    // catch-up cap, so the 10 fps machine keeps pace with the 120 fps reference.
    expect(stepped.loop.tick()).toBe(60);
    expect(slow.loop.tick()).toBe(60);
  });

  it('exposes interpolation alpha between the last step and the next', () => {
    const { loop } = makeLoop();
    loop.advance(0);
    loop.advance(25); // halfway into the first step
    expect(loop.alpha()).toBeCloseTo(0.5, 5);
    loop.advance(50); // past it
    expect(loop.alpha()).toBeLessThan(1);
  });
});

describe('death spiral', () => {
  it('caps catch-up at maxCatchUpSteps and drops the rest', () => {
    // maxFrameMs above the production default: this test exercises the catch-up cap itself,
    // not the frame clamp that normally masks it.
    const { loop, ticks } = makeLoop({ maxFrameMs: 5000 });
    loop.advance(0);
    // A 2 s stall, as from a breakpoint or a GC pause.
    loop.advance(2000);
    expect(ticks).toHaveLength(LOOP.maxCatchUpSteps);
    const stats = loop.stats();
    expect(stats.catchUpFrames).toBe(1);
    // 2000 ms = 40 steps; 5 ran, 35 dropped.
    expect(stats.droppedMs).toBeCloseTo(35 * STEP, 1);
    expect(stats.lastSteps).toBe(LOOP.maxCatchUpSteps);
  });

  it('recovers to normal step counts on the next frame', () => {
    const { loop } = makeLoop({ maxFrameMs: 5000 });
    loop.advance(0);
    loop.advance(2000); // stall
    loop.advance(2050); // one normal frame after
    expect(loop.stats().lastSteps).toBe(1);
    // And the accumulator did NOT grow unboundedly across the stall.
    expect(loop.stats().droppedMs).toBeGreaterThan(0);
  });

  it('survives a pathological stall storm without runaway growth', () => {
    const { loop, ticks } = makeLoop();
    loop.advance(0);
    let now = 1;
    for (let i = 0; i < 50; i++) {
      now += 2000; // every frame stalls for 2 s
      loop.advance(now);
    }
    // 50 frames × 5 steps each, never more — the spiral is structurally impossible.
    expect(ticks.length).toBe(50 * LOOP.maxCatchUpSteps);
  });

  it('treats a negative time jump as no time at all', () => {
    const { loop, ticks } = makeLoop();
    loop.advance(1000);
    loop.advance(500); // clock went backwards
    expect(ticks).toHaveLength(0);
  });
});

describe('pause, step, and speed', () => {
  it('stops simulating while paused', () => {
    const { loop, ticks } = makeLoop();
    loop.advance(0);
    loop.pause();
    let now = 50;
    for (let i = 0; i < 10; i++) {
      loop.advance(now);
      now += 50;
    }
    expect(ticks).toHaveLength(0);
    expect(loop.tick()).toBe(0);
  });

  it('single-steps while paused', () => {
    const { loop, ticks } = makeLoop();
    loop.pause();
    loop.advance(0);
    loop.advance(16);
    loop.stepOnce(3);
    loop.advance(33);
    loop.advance(50);
    expect(ticks).toEqual([0, 1, 2]);
    expect(loop.paused()).toBe(true);
  });

  it('multiplies simulated time by speed', () => {
    const { loop, ticks } = makeLoop({ maxCatchUpSteps: 16 });
    loop.setSpeed(4);
    loop.advance(0);
    loop.advance(200); // 200 ms × 4 = 800 ms = 16 steps
    expect(ticks).toHaveLength(16);
  });

  it('cycles 1× → 4× → 16× → 1×', () => {
    const { loop } = makeLoop();
    expect(loop.speed()).toBe(1);
    expect(loop.cycleSpeed()).toBe(4);
    expect(loop.cycleSpeed()).toBe(16);
    expect(loop.cycleSpeed()).toBe(1);
  });

  it('alpha is 0 while paused — renderers freeze rather than glide', () => {
    const { loop } = makeLoop();
    loop.advance(0);
    loop.advance(30);
    loop.pause();
    expect(loop.alpha()).toBe(0);
  });
});

describe('determinism hooks', () => {
  it('runTicks produces exactly n steps with no dependency on wall time', () => {
    const { loop, ticks } = makeLoop();
    loop.runTicks(50);
    expect(ticks).toEqual(Array.from({ length: 50 }, (_, i) => i));
    expect(loop.tick()).toBe(50);
  });

  it('two loops fed the same timestamps produce identical tick sequences', () => {
    const a = makeLoop();
    const b = makeLoop();
    for (let now = 0; now <= 5000; now += 16.6) {
      a.loop.advance(now);
      b.loop.advance(now);
    }
    expect(a.loop.tick()).toBe(b.loop.tick());
    expect(a.ticks).toEqual(b.ticks);
  });

  it('reset restores a clean baseline', () => {
    const { loop } = makeLoop();
    loop.advance(0);
    loop.advance(2000);
    loop.reset(7);
    expect(loop.tick()).toBe(7);
    expect(loop.stats().steps).toBe(0);
    expect(loop.stats().droppedMs).toBe(0);
  });
});
