/**
 * Named, repeatable scripted-scenario presets — "replay 'player kills all wolves at tick 1000'
 * repeatedly while tuning" (card point 9). Used by the dashboard's scenario runner and by
 * tests/ecology/cascade-wolves.test.ts, so the exact same script is what gets tuned against and
 * what gets asserted on.
 */

import { speciesId, type RegionId, type Tick } from '@contracts/index';
import type { ScriptedKill } from '../sim';
import { syntheticRegions } from '../regions';

const REGION_0: RegionId = syntheticRegions()[0]!.id;

function killAllAt(species: string, region: RegionId = REGION_0, atTick = 1_000, count = 20, spacing = 5): ScriptedKill[] {
  return Array.from({ length: count }, (_, i) => ({
    tick: (atTick + i * spacing) as Tick,
    speciesId: speciesId(species),
    regionId: region,
  }));
}

export const SCENARIOS = {
  'kill all wolves': killAllAt('grey_wolf'),
  'kill all lynx': killAllAt('lynx'),
  'kill all otters': killAllAt('river_otter'),
  'kill all bees': killAllAt('meadow_bee', REGION_0, 1_000, 15, 5),
  'overfish the lake': killAllAt('lake_fish', REGION_0, 1_000, 25, 4),
} satisfies Record<string, ScriptedKill[]>;

export { REGION_0 as defaultScenarioRegion };
