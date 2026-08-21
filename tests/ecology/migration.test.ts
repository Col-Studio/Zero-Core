import { describe, expect, it } from 'vitest';
import { regionId, speciesId, type RegionId, type SpeciesId, type Tick } from '@contracts/index';
import { bestSourceNeighbor, diffuseRegions, popDueMigrations, scheduleMigration, type MigrationQueue, type WorldStocks } from '../../src/ecology/migration';
import type { RegionNode } from '../../src/ecology/regions';

const A = regionId('a');
const B = regionId('b');
const DEER = speciesId('red_deer');

const regions: RegionNode[] = [
  { id: A, biome: 'meadow', neighbors: [B] },
  { id: B, biome: 'meadow', neighbors: [A] },
];

describe('diffuseRegions', () => {
  it('flows population from the denser (normalized) region toward the sparser one', () => {
    const stocks: WorldStocks = new Map([
      [A, new Map<SpeciesId, number>([[DEER, 140]])],
      [B, new Map<SpeciesId, number>([[DEER, 10]])],
    ]);
    const veg = new Map<RegionId, number>([[A, 0.6], [B, 0.6]]);

    const result = diffuseRegions(stocks, regions, veg);
    expect(result.get(A)!.get(DEER)!).toBeLessThan(140);
    expect(result.get(B)!.get(DEER)!).toBeGreaterThan(10);
  });

  it('does not move anything when regions are already balanced', () => {
    const stocks: WorldStocks = new Map([
      [A, new Map<SpeciesId, number>([[DEER, 75]])],
      [B, new Map<SpeciesId, number>([[DEER, 75]])],
    ]);
    const veg = new Map<RegionId, number>([[A, 0.6], [B, 0.6]]);
    const result = diffuseRegions(stocks, regions, veg);
    expect(result.get(A)!.get(DEER)!).toBeCloseTo(75, 5);
  });
});

describe('scheduled migrations', () => {
  it('a scheduled migration is not due until its dueTick', () => {
    const queue: MigrationQueue = [];
    scheduleMigration(queue, DEER, A, null, 0.5, 'niche-vacant', 100 as Tick, 400);
    expect(popDueMigrations(queue, 400 as Tick)).toHaveLength(0);
    expect(popDueMigrations(queue, 500 as Tick)).toHaveLength(1);
  });

  it('bestSourceNeighbor picks the neighbor with the largest surplus, and null if none qualify', () => {
    const stocks: WorldStocks = new Map([[B, new Map<SpeciesId, number>([[DEER, 42]])]]);
    const region: RegionNode = { id: A, biome: 'meadow', neighbors: [B] };
    expect(bestSourceNeighbor(DEER, region, stocks)).toBe(B);

    const empty: WorldStocks = new Map([[B, new Map<SpeciesId, number>([[DEER, 0.2]])]]);
    expect(bestSourceNeighbor(DEER, region, empty)).toBeNull();
  });
});
