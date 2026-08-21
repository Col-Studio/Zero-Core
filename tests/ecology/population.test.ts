import { describe, expect, it } from 'vitest';
import { speciesId, type SpeciesId } from '@contracts/index';
import { capacityFor, stepRegionPopulations } from '../../src/ecology/population';
import { speciesDef, SPECIES } from '../../src/ecology/species.data';
import { SEASON_MODIFIERS } from '../../src/ecology/seasons.data';

describe('population model', () => {
  it('capacityFor gives a lower capacity off-biome than on-biome', () => {
    const wolf = speciesDef(speciesId('grey_wolf'));
    const onBiome = capacityFor(wolf, 'forest', 0.6);
    const offBiome = capacityFor(wolf, 'badlands', 0.6);
    expect(onBiome).toBeGreaterThan(offBiome);
  });

  it('a species left alone settles near its carrying capacity, not oscillating wildly', () => {
    const wolf = speciesDef(speciesId('grey_wolf'));
    const deer = speciesDef(speciesId('red_deer'));
    const grass = speciesDef(speciesId('meadow_grass'));
    let stocks = new Map<SpeciesId, number>([
      [wolf.id, capacityFor(wolf, 'forest', 0.6) * 0.5],
      [deer.id, capacityFor(deer, 'forest', 0.6) * 0.5],
      [grass.id, capacityFor(grass, 'forest', 0.6) * 0.5],
    ]);

    for (let t = 0; t < 20_000; t++) {
      const result = stepRegionPopulations({
        biome: 'forest',
        vegetationDensity: 0.6,
        season: SEASON_MODIFIERS.summer,
        stocks,
        recentDeathRate: 0,
      });
      stocks = result.stocks;
    }

    const wolfCap = capacityFor(wolf, 'forest', 0.6);
    const wolfStock = stocks.get(wolf.id) ?? 0;
    expect(wolfStock).toBeGreaterThan(wolfCap * 0.05);
    expect(wolfStock).toBeLessThan(wolfCap * 1.4);
  });

  it('no single tick can change a stock by more than the damping cap allows', () => {
    const hare = speciesDef(speciesId('hare'));
    const stocks = new Map<SpeciesId, number>();
    for (const s of SPECIES) stocks.set(s.id, capacityFor(s, 'meadow', 0.9) * 0.01);
    stocks.set(hare.id, capacityFor(hare, 'meadow', 0.9) * 0.99);

    const before = stocks.get(hare.id)!;
    const result = stepRegionPopulations({
      biome: 'meadow',
      vegetationDensity: 0.9,
      season: SEASON_MODIFIERS.spring,
      stocks,
      recentDeathRate: 0,
    });
    const after = result.stocks.get(hare.id)!;
    expect(Math.abs(after - before)).toBeLessThan(before * 0.05);
  });

  it('a rate multiplier below 1 measurably suppresses growth relative to no multiplier', () => {
    const deer = speciesDef(speciesId('red_deer'));
    const baseStocks = new Map<SpeciesId, number>();
    for (const s of SPECIES) baseStocks.set(s.id, capacityFor(s, 'meadow', 0.7) * 0.3);

    const normal = stepRegionPopulations({ biome: 'meadow', vegetationDensity: 0.7, season: SEASON_MODIFIERS.spring, stocks: baseStocks, recentDeathRate: 0 });
    const suppressed = stepRegionPopulations({
      biome: 'meadow',
      vegetationDensity: 0.7,
      season: SEASON_MODIFIERS.spring,
      stocks: baseStocks,
      recentDeathRate: 0,
      rateMultipliers: new Map([[deer.id, 0.2]]),
    });

    expect(suppressed.stocks.get(deer.id)!).toBeLessThan(normal.stocks.get(deer.id)!);
  });
});
