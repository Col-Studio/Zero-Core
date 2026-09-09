/**
 * The core runtime: one object that owns the ECS world, the scheduler, the fixed loop, the save
 * manager, the replay recorder, and the perf harness — plus the singleton the shell and the dev
 * overlay read it through.
 *
 * ## Why a singleton
 *
 * `MountFn` returns nothing, and the other six modules must never import `@core/*`. So the shell
 * calls `mountCore(ctx)` and then reads the runtime back through `getCoreRuntime()`; the dev
 * overlay does the same. One process, one simulation — a second runtime would mean two tick
 * counters, and every module reads the tick through `ctx.getTick()`.
 *
 * ## The tick is owned here
 *
 * `bus.setTick()` is called once per simulation step, before any system runs, so every event
 * emitted during a step is stamped with the tick that produced it. Nothing else in the codebase
 * may advance the tick.
 */

import type { EventBus, GameEventType, Stamped } from '@contracts/events';
import type { MountContext, ServiceRegistryLike } from '@contracts/services';
import type { Tick } from '@contracts/ids';
import type { Rng } from '@contracts/rng';
import { EcsWorld } from '@core/ecs/world';
import { SystemScheduler, type SystemContext } from './ecs/system';
import { createFixedLoop, type FixedLoop } from './loop/fixedLoop';
import { createLoopDriver, type LoopDriver } from './loop/driver';
import { createPerfBudget, type PerfBudget } from './perf/budget';
import { createSnapshotSource, type SnapshotSource } from './save/snapshot';
import { createSaveManager, type SaveManager } from './save/manager';
import { createSaveStore, type SaveStore } from './save/store';
import { createRecorder, type Recorder } from './save/replay';
import { createReferenceSim, type ReferenceSim } from './sim/reference';
import { ECS, LOOP, SCENES } from './core.data';

export interface EventTailEntry {
  tick: Tick;
  type: GameEventType;
  /** One-line human summary for the overlay. */
  text: string;
}

export interface CoreRuntime {
  readonly world: EcsWorld;
  readonly scheduler: SystemScheduler;
  readonly loop: FixedLoop;
  readonly driver: LoopDriver;
  readonly perf: PerfBudget;
  readonly saves: SaveManager;
  readonly snapshots: SnapshotSource;
  readonly recorder: Recorder;
  readonly sim: ReferenceSim;
  readonly bus: EventBus;
  readonly rng: Rng;
  readonly services: ServiceRegistryLike;
  readonly seed: number;
  getTick(): Tick;
  /** Fresh system context for the tick being simulated. */
  context(tick: Tick): SystemContext;
  /** Last `limit` events, newest last. The overlay's event tail. */
  eventTail(limit?: number): readonly EventTailEntry[];
  /** Subscribe to tick changes — React components use this instead of polling in a hook. */
  onTick(listener: (tick: Tick) => void): () => void;
  dispose(): void;
}

export interface CoreRuntimeOptions {
  ctx: MountContext;
  /** Entities to populate the reference sim with. Debug scenes override it. */
  entities?: number;
  /** Storage backend. Tests inject a memory store. */
  store?: SaveStore;
  /** Start the rAF driver. False in tests and in `?freeze=1` captures. */
  autoStart?: boolean;
  /** Simulate this many ticks synchronously at mount (`?tick=`). */
  fastForwardTo?: Tick;
}

let current: CoreRuntime | null = null;

/** The live runtime, or null before `mountCore`. */
export const getCoreRuntime = (): CoreRuntime | null => current;

export function createCoreRuntime(options: CoreRuntimeOptions): CoreRuntime {
  const { ctx } = options;
  // Fork our own stream. Drawing from ctx.rng directly would mean another module's draw count
  // silently changes core's results — the exact desync forks exist to prevent.
  const rng = ctx.rng.fork('core');

  const capacity = Math.max(ECS.initialCapacity as number, (options.entities ?? SCENES.saveEntities) * 2);
  const world = new EcsWorld(capacity);
  const perf = createPerfBudget();
  const scheduler = new SystemScheduler(perf);
  const sim = createReferenceSim({ world, bus: ctx.bus, rng, capacity });

  const tickListeners = new Set<(tick: Tick) => void>();
  const tail: EventTailEntry[] = [];
  const TAIL_LIMIT = 64;

  const unsubscribeTail = ctx.bus.onAny((event: Stamped) => {
    tail.push({ tick: event.tick, type: event.type, text: describe(event) });
    if (tail.length > TAIL_LIMIT) tail.shift();
  }, 'core.overlay.tail');

  const snapshots = createSnapshotSource({
    seed: ctx.seed,
    world,
    getTick: () => loop.tick(),
  });
  snapshots.register({ id: 'core', capture: sim.capture, restore: sim.restore });

  const recorder = createRecorder(ctx.bus);

  const saves = createSaveManager({
    source: snapshots,
    store: options.store ?? createSaveStore(),
    seed: ctx.seed,
    events: () => recorder.events(),
  });

  const loop = createFixedLoop({
    startTick: options.fastForwardTo === undefined ? 0 : 0,
    startPaused: ctx.frozen,
    onStep: (tick, dt) => {
      // Stamp first: every event emitted by a system this step belongs to this tick.
      ctx.bus.setTick(tick);
      perf.begin('core.step');
      scheduler.step(dt, runtime.context(tick));
      perf.end('core.step');
      saves.onTick(tick);
    },
    onTick: (tick) => {
      for (const listener of tickListeners) listener(tick);
    },
  });

  const driver = createLoopDriver(loop, {
    onFrame: () => perf.frame(),
  });

  const runtime: CoreRuntime = {
    world,
    scheduler,
    loop,
    driver,
    perf,
    saves,
    snapshots,
    recorder,
    sim,
    bus: ctx.bus,
    rng,
    services: ctx.services,
    seed: ctx.seed,

    getTick: () => loop.tick(),

    context: (tick) => ({
      world,
      bus: ctx.bus,
      rng,
      // Resolved through the registry at CALL time — never cached, or this holds a Null forever.
      services: ctx.services,
      tick,
    }),

    eventTail: (limit = 12) => tail.slice(Math.max(0, tail.length - limit)),

    onTick(listener) {
      tickListeners.add(listener);
      return () => tickListeners.delete(listener);
    },

    dispose() {
      driver.stop();
      scheduler.dispose();
      recorder.dispose();
      sim.dispose();
      unsubscribeTail();
      tickListeners.clear();
      if (current === runtime) current = null;
    },
  };

  for (const system of sim.systems()) scheduler.add(system, runtime.context(0));
  sim.populate(options.entities ?? SCENES.saveEntities);

  // `?tick=n` — simulate n steps before the first frame so a screenshot at tick n is exactly
  // reproducible. Capped so a typo in the URL cannot hang the tab for minutes.
  const target = Math.min(options.fastForwardTo ?? 0, 200_000);
  if (target > 0) loop.runTicks(target);

  ctx.bus.setTick(loop.tick());

  if (options.autoStart !== false) driver.start();

  current = runtime;
  return runtime;
}

/** Short human text for the overlay's event tail. */
function describe(event: Stamped): string {
  const data = event as unknown as Record<string, unknown>;
  switch (event.type) {
    case 'creature:died':
      return `${String(data.speciesId)} died (${String(data.cause)})`;
    case 'creature:born':
      return `${String(data.speciesId)} born`;
    case 'player:attacked':
      return `attack ${String(data.damage)}${data.isCrit === true ? ' crit' : ''}`;
    case 'population:changed':
      return `${String(data.speciesId)} → ${String(data.count)}`;
    case 'cascade:triggered':
      return `cascade ${String(data.ruleId)}`;
    default:
      return event.type;
  }
}

/** Seconds of simulated time per second of wall clock, at the current speed. */
export const simRate = (speed: number): number => speed * (LOOP.tickRate / LOOP.tickRate);
