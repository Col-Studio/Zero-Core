/**
 * Region roster used by the simulation core. `ecology` never generates terrain — it only needs
 * an id, a biome (for carrying-capacity affinity), and neighbour ids (for region coupling, point
 * 7 of the card). In the full game this comes from `IWorldQuery.getAllRegions()`; headless tests
 * and the standalone dev harness use a small synthetic map instead so tuning runs stay fast and
 * fully deterministic without a browser.
 */

import { regionId, type BiomeKind, type IWorldQuery, type RegionId } from '@contracts/index';

export interface RegionNode {
  id: RegionId;
  biome: BiomeKind;
  neighbors: RegionId[];
}

/** Read the live region graph through the service accessor. Called at use time, never cached. */
export function regionsFromWorld(world: IWorldQuery): RegionNode[] {
  return world.getAllRegions().map((r) => ({
    id: r.id,
    biome: r.biome,
    neighbors: [...r.neighbors],
  }));
}

/**
 * A small deterministic 3x3 grid, one of each of the 6 biomes plus 3 repeats, wired with 4-way
 * adjacency. Used for headless tuning (`simulateEcology`), unit tests, and the dev harness before
 * a real `world` module is present. 9 regions keeps `simulateEcology(seed, 100_000, ...)` well
 * under a second — see population.ts for why the per-tick cost is O(regions x species).
 */
export function syntheticRegions(): RegionNode[] {
  const biomes: BiomeKind[] = ['meadow', 'forest', 'alpine', 'wetland', 'badlands', 'ashland', 'meadow', 'forest', 'wetland'];
  const size = 3;
  const idAt = (ix: number, iz: number): RegionId => regionId(`syn_${ix}_${iz}`);
  const nodes: RegionNode[] = [];
  for (let iz = 0; iz < size; iz++) {
    for (let ix = 0; ix < size; ix++) {
      const neighbors: RegionId[] = [];
      if (ix > 0) neighbors.push(idAt(ix - 1, iz));
      if (ix < size - 1) neighbors.push(idAt(ix + 1, iz));
      if (iz > 0) neighbors.push(idAt(ix, iz - 1));
      if (iz < size - 1) neighbors.push(idAt(ix, iz + 1));
      nodes.push({ id: idAt(ix, iz), biome: biomes[(iz * size + ix) % biomes.length]!, neighbors });
    }
  }
  return nodes;
}

/** A tiny 4-region ring, used only by the long-horizon stability fuzz test to keep it fast. */
export function fuzzRegions(): RegionNode[] {
  const biomes: BiomeKind[] = ['meadow', 'forest', 'wetland', 'badlands'];
  const ids = biomes.map((_, i) => regionId(`fuzz_${i}`));
  return biomes.map((biome, i) => ({
    id: ids[i]!,
    biome,
    neighbors: [ids[(i + 1) % ids.length]!, ids[(i - 1 + ids.length) % ids.length]!],
  }));
}
