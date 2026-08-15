/**
 * FROZEN — integration lead only. See CLAUDE.md § Frozen files.
 *
 * Null Object implementations of all six services.
 *
 * These are the reason seven isolated agents never block each other. Every module injects Nulls
 * for the five services it does not own and develops against them for the whole project; at
 * merge time the integration lead swaps them for real implementations one at a time.
 *
 * They are deliberately NOT empty stubs. Each returns deterministic, plausible, *live* data:
 * rolling terrain with a lake, populations that drift and remember player kills, creatures that
 * orbit and bleed, villages with economies, a mission you can accept. If your module looks and
 * feels right against these, it will work against the real thing.
 *
 *   import { createNullServices } from '@contracts/nulls';
 *   const services = createNullServices(() => tick);
 */

export { createNullWorldQuery, nullHeightAt } from './nulls/world';
export { createNullEcologyQuery, NULL_SPECIES } from './nulls/ecology';
export { createNullCreatureQuery } from './nulls/creatures';
export {
  createNullPlayerQuery,
  createNullSocietyQuery,
  createNullPresentation,
  type NullPresentation,
  type RecordedCall,
} from './nulls/actors';

import type { Tick } from './ids';
import type { ServiceRegistryLike } from './services';
import { createNullWorldQuery } from './nulls/world';
import { createNullEcologyQuery } from './nulls/ecology';
import { createNullCreatureQuery } from './nulls/creatures';
import {
  createNullPlayerQuery,
  createNullPresentation,
  createNullSocietyQuery,
} from './nulls/actors';

/**
 * A full set of Null services, wired to a tick source so the fakes animate.
 *
 * Pass a real tick getter (`() => loop.tick`) and the Null world will breathe: populations
 * drift, creatures orbit, the player walks a circuit. Pass nothing and everything freezes at
 * tick 0 — which is exactly what you want for a screenshot comparison.
 */
export function createNullServices(getTick: () => Tick = () => 0): ServiceRegistryLike {
  const world = createNullWorldQuery();
  const ecology = createNullEcologyQuery(getTick);
  const creatures = createNullCreatureQuery(getTick);
  const player = createNullPlayerQuery(getTick);
  const society = createNullSocietyQuery();
  const presentation = createNullPresentation();

  return {
    world: () => world,
    ecology: () => ecology,
    creatures: () => creatures,
    player: () => player,
    society: () => society,
    presentation: () => presentation,
  };
}
