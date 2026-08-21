/**
 * Two distinct cross-region mechanisms (card points 6 and 7):
 *   • `diffuseRegions` — continuous, small, every tick: neighbouring regions exchange population
 *     proportional to the normalized-stock gradient between them. This is what lets a cascade
 *     that started in one region visibly propagate to its neighbours over time.
 *   • scheduled migrations — discrete, rule-triggered: a nature rule's `migration` effect (e.g.
 *     "the niche is vacant, something bigger is coming") schedules an arrival after a realistic
 *     delay rather than an instant teleport. `ecology` owns the numbers only — it emits
 *     `species:migrating` and lets Member 4 (creatures) spawn the actual bodies.
 */

import type { RegionId, SpeciesId, Tick } from '@contracts/index';
import type { RegionNode } from './regions';
import { speciesDef } from './species.data';
import { capacityFor } from './population';
import { DIFFUSION_RATE, MIGRATION_DELAY_TICKS } from './migration.data';

export type RegionStocks = ReadonlyMap<SpeciesId, number>;
export type WorldStocks = Map<RegionId, Map<SpeciesId, number>>;

/**
 * One diffusion pass over every region/species. Reads `stocks` and returns a new map with the
 * same shape — callers apply it after `stepRegionPopulations` so within-region trophic dynamics
 * settle first, then a small cross-region flow happens on top.
 */
export function diffuseRegions(
  stocks: WorldStocks,
  regions: readonly RegionNode[],
  vegetationByRegion: ReadonlyMap<RegionId, number>,
): WorldStocks {
  const byId = new Map(regions.map((r) => [r.id, r]));
  const next: WorldStocks = new Map();
  for (const [regionId, regionStocks] of stocks) next.set(regionId, new Map(regionStocks));

  for (const region of regions) {
    const regionStocks = stocks.get(region.id);
    if (regionStocks === undefined) continue;
    const veg = vegetationByRegion.get(region.id) ?? 0.5;

    for (const [speciesId, stock] of regionStocks) {
      const species = speciesDef(speciesId);
      const capHere = capacityFor(species, region.biome, veg);
      const normHere = stock / capHere;

      for (const neighborId of region.neighbors) {
        const neighborStocks = stocks.get(neighborId);
        const neighborNode = byId.get(neighborId);
        if (neighborStocks === undefined || neighborNode === undefined) continue;
        const neighborStock = neighborStocks.get(speciesId) ?? 0;
        const neighborVeg = vegetationByRegion.get(neighborId) ?? 0.5;
        const capThere = capacityFor(species, neighborNode.biome, neighborVeg);
        const normThere = neighborStock / capThere;

        const gradient = normHere - normThere;
        if (Math.abs(gradient) < 0.001) continue;
        const flow = gradient * DIFFUSION_RATE * capHere;

        const here = next.get(region.id)!;
        const there = next.get(neighborId)!;
        here.set(speciesId, Math.max(0, (here.get(speciesId) ?? stock) - flow));
        there.set(speciesId, Math.max(0, (there.get(speciesId) ?? neighborStock) + flow));
      }
    }
  }

  return next;
}

export interface MigrationTask {
  id: string;
  speciesId: SpeciesId;
  toRegion: RegionId;
  fromRegion: RegionId | null;
  countFraction: number;
  reason: 'niche-vacant' | 'overcrowding' | 'famine' | 'disaster' | 'season';
  dueTick: Tick;
}

export type MigrationQueue = MigrationTask[];

let taskCounter = 0;

export function scheduleMigration(
  queue: MigrationQueue,
  speciesId: SpeciesId,
  toRegion: RegionId,
  fromRegion: RegionId | null,
  countFraction: number,
  reason: MigrationTask['reason'],
  now: Tick,
  delay: number = MIGRATION_DELAY_TICKS,
): void {
  taskCounter += 1;
  queue.push({
    id: `mig_${taskCounter}_${speciesId}`,
    speciesId,
    toRegion,
    fromRegion,
    countFraction,
    reason,
    dueTick: now + delay,
  });
}

/** Pops (and returns) every task due at or before `tick`, mutating the queue in place. */
export function popDueMigrations(queue: MigrationQueue, tick: Tick): MigrationTask[] {
  const due: MigrationTask[] = [];
  const remaining: MigrationQueue = [];
  for (const task of queue) {
    if (task.dueTick <= tick) due.push(task);
    else remaining.push(task);
  }
  queue.length = 0;
  queue.push(...remaining);
  return due;
}

/** Finds the neighbour with the largest surplus of `speciesId`, for `fromAdjacent` migrations. */
export function bestSourceNeighbor(
  speciesId: SpeciesId,
  region: RegionNode,
  stocks: WorldStocks,
): RegionId | null {
  let best: RegionId | null = null;
  let bestStock = 0;
  for (const neighborId of region.neighbors) {
    const stock = stocks.get(neighborId)?.get(speciesId) ?? 0;
    if (stock > bestStock) {
      bestStock = stock;
      best = neighborId;
    }
  }
  return bestStock > 1 ? best : null;
}
