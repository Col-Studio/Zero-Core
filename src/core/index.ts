/**
 * `core`'s public API.
 *
 * The shell calls `mountCore(ctx)`; the dev overlay and the debug scenes read the runtime back
 * through `getCoreRuntime()`. The other six modules import NONE of this — they see the engine
 * only through `@contracts` and the event bus, which is what lets seven branches merge without
 * a rewrite. (`scripts/check-boundaries.mjs` enforces it, so this is a guarantee rather than an
 * aspiration.)
 *
 * Everything below is re-exported for tests, tooling, and the eventual day when a module needs a
 * primitive rather than a service. Adding an export here is a contract change: say so at merge.
 */

import type { MountContext } from '@contracts/services';
import type { Tick } from '@contracts/ids';
import { createCoreRuntime, getCoreRuntime, type CoreRuntime } from './runtime';
import { SCENES } from './core.data';

export { createCoreRuntime, getCoreRuntime, type CoreRuntime } from './runtime';
export { EcsWorld, type Component, type Query, type EcsSnapshot } from '@core/ecs/world';
export { soa, objects, type ComponentStore, type SoaStore } from './ecs/store';
export { EntityManager, packEntity, entityIndex, entityGeneration } from './ecs/entity';
export {
  SystemScheduler,
  defineSystem,
  ORDER,
  type System,
  type SystemContext,
} from './ecs/system';
export { createFixedLoop, type FixedLoop, type LoopStats } from './loop/fixedLoop';
export { createLoopDriver, type LoopDriver } from './loop/driver';
export { createPerfBudget, formatReport, type PerfBudget, type PerfReport } from './perf/budget';
export { createSaveManager, type SaveManager } from './save/manager';
export { createSaveStore, createMemorySaveStore, type SaveStore } from './save/store';
export { createSnapshotSource, type ModuleSerializer } from './save/snapshot';
export { createRecorder, replay, DEFAULT_INPUT_EVENTS, type Recorder } from './save/replay';
export { createReferenceSim, type ReferenceSim } from './sim/reference';
export { LOOP, ECS, SAVE, PERF, SCENES } from './core.data';

/** How many entities each debug scene asks for. `?scene=core` is the 10k stress test. */
function entitiesFor(scene: string | null): number {
  switch (scene) {
    case 'core':
      return SCENES.stressEntities;
    case 'loop':
      return SCENES.loopEntities;
    case 'save':
      return SCENES.saveEntities;
    default:
      return SCENES.defaultEntities;
  }
}

/**
 * Mount the engine. Called once by the shell, inside an error boundary.
 *
 * Returns a cleanup function, as `MountFn` allows: HMR remounts in dev, and a runtime left
 * running behind a replaced one would keep simulating and stamping the bus with its own ticks.
 */
export function mountCore(ctx: MountContext): () => void {
  const existing = getCoreRuntime();
  if (existing !== null) existing.dispose();

  const runtime: CoreRuntime = createCoreRuntime({
    ctx,
    entities: entitiesFor(ctx.debugScene),
    // The shell seeds `getTick()` with `?tick=`, so this is where fast-forward comes from.
    fastForwardTo: ctx.getTick() as Tick,
    autoStart: true,
  });

  return () => runtime.dispose();
}
