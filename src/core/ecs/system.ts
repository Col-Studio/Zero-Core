/**
 * Systems and the scheduler.
 *
 * A system is `{ name, order, update(dt, ctx) }` and nothing more — no lifecycle, no dependency
 * graph. `order` is an explicit integer because implicit ordering is where deterministic
 * simulations go to die: two systems registered in a different order on two machines produce two
 * different worlds from the same seed.
 *
 * `dt` is ALWAYS the fixed step (1/20 s). It is passed rather than imported so a system can be
 * unit-tested at any rate, but the loop never varies it — variable dt is non-deterministic.
 */

import type { EventBus } from '@contracts/events';
import type { Tick } from '@contracts/ids';
import type { Rng } from '@contracts/rng';
import type { ServiceRegistryLike } from '@contracts/services';
import type { EcsWorld } from '@core/ecs/world';

/** What every system receives. Services are resolved through the registry AT CALL TIME. */
export interface SystemContext {
  world: EcsWorld;
  bus: EventBus;
  rng: Rng;
  services: ServiceRegistryLike;
  /** The tick being simulated. Systems must read time from here, never from a clock. */
  tick: Tick;
}

export interface System {
  readonly name: string;
  /** Lower runs first. Convention: input 0-99, simulation 100-499, reactions 500-899, late 900+. */
  readonly order: number;
  update(dt: number, ctx: SystemContext): void;
  /** Optional one-shot setup, run when the system is added. */
  init?(ctx: SystemContext): void;
  /** Optional teardown, run on removal or scheduler disposal. */
  dispose?(): void;
}

/** Timing sink — the perf harness implements this to attribute frame time per system. */
export interface SystemProfiler {
  begin(name: string): void;
  end(name: string): void;
}

/** Conventional order bands, so seven modules interleave predictably. */
export const ORDER = {
  input: 0,
  simulation: 100,
  ecology: 200,
  ai: 300,
  physics: 400,
  reactions: 500,
  cleanup: 900,
} as const;

export class SystemScheduler {
  private systems: System[] = [];
  private dirty = false;

  constructor(private readonly profiler?: SystemProfiler) {}

  add(system: System, ctx?: SystemContext): this {
    if (this.systems.some((existing) => existing.name === system.name)) {
      throw new Error(`scheduler: system '${system.name}' is already registered`);
    }
    this.systems.push(system);
    this.dirty = true;
    if (ctx !== undefined) system.init?.(ctx);
    return this;
  }

  remove(name: string): boolean {
    const index = this.systems.findIndex((system) => system.name === name);
    if (index < 0) return false;
    this.systems[index]!.dispose?.();
    this.systems.splice(index, 1);
    return true;
  }

  has(name: string): boolean {
    return this.systems.some((system) => system.name === name);
  }

  /** Registered systems in execution order. The overlay lists these. */
  list(): readonly System[] {
    this.sort();
    return this.systems;
  }

  /**
   * Run one simulation step. A throwing system is contained and reported exactly like a throwing
   * bus listener: one broken module must not stop the other six from simulating.
   */
  step(dt: number, ctx: SystemContext): void {
    this.sort();
    for (const system of this.systems) {
      this.profiler?.begin(system.name);
      try {
        system.update(dt, ctx);
      } catch (error) {
        console.error(`[scheduler] system '${system.name}' threw on tick ${ctx.tick}:`, error);
      } finally {
        this.profiler?.end(system.name);
      }
    }
  }

  dispose(): void {
    for (const system of this.systems) system.dispose?.();
    this.systems.length = 0;
  }

  /**
   * Stable sort by `order`. Ties keep registration order, which is fixed by the shell's module
   * list — so the execution order is a property of the build, not of the machine.
   */
  private sort(): void {
    if (!this.dirty) return;
    this.systems = this.systems
      .map((system, index) => ({ system, index }))
      .sort((a, b) => a.system.order - b.system.order || a.index - b.index)
      .map((entry) => entry.system);
    this.dirty = false;
  }
}

/** Terse helper for the common case. */
export function defineSystem(
  name: string,
  order: number,
  update: (dt: number, ctx: SystemContext) => void,
): System {
  return { name, order, update };
}
