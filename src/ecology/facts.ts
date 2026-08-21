import type { RegionId, SpeciesId, Tick, WeatherKind } from '@contracts/index';
import type { RegionFacts } from './rulesEngine';
import type { RegionNode } from './regions';
import { SPECIES } from './species.data';
import { capacityFor } from './population';
import { regionalDecayedPressure, type PressureLedger } from './pressure';
import type { ActiveRateModifier } from './state';

export function buildRegionFacts(
  region: RegionNode,
  stocks: ReadonlyMap<SpeciesId, number>,
  vegetation: number,
  pressureLedger: PressureLedger,
  tick: Tick,
  weather: WeatherKind,
): RegionFacts {
  const populationNormalized: Record<string, number> = {};
  const playerKillsDecayed: Record<string, number> = {};

  for (const species of SPECIES) {
    const cap = capacityFor(species, region.biome, vegetation);
    const stock = stocks.get(species.id) ?? 0;
    populationNormalized[species.id] = cap <= 0 ? 0 : stock / cap;
    playerKillsDecayed[species.id] = regionalDecayedPressure(pressureLedger, species.id, region.id, tick);
  }

  return {
    regionId: region.id,
    populationNormalized,
    vegetation,
    playerKillsDecayed,
    weather,
    economyStress: 0.5, // neutral until `society` is merged; see INTEGRATION_NOTES.md
  };
}

/** Product of every non-expired multiplier for each species in one region, pruning as it goes. */
export function activeRateMultipliers(
  modifiers: Map<string, ActiveRateModifier[]>,
  regionId: RegionId,
  tick: Tick,
): Map<SpeciesId, number> {
  const out = new Map<SpeciesId, number>();
  for (const species of SPECIES) {
    const key = `${species.id}|${regionId}`;
    const list = modifiers.get(key);
    if (list === undefined || list.length === 0) continue;
    const alive = list.filter((m) => m.expiresTick > tick);
    if (alive.length !== list.length) modifiers.set(key, alive);
    if (alive.length === 0) {
      modifiers.delete(key);
      continue;
    }
    let product = 1;
    for (const m of alive) product *= m.multiplier;
    out.set(species.id, product);
  }
  return out;
}

export function addRateModifier(
  modifiers: Map<string, ActiveRateModifier[]>,
  speciesId: SpeciesId,
  regionId: RegionId,
  multiplier: number,
  expiresTick: Tick,
): void {
  const key = `${speciesId}|${regionId}`;
  const list = modifiers.get(key) ?? [];
  list.push({ multiplier, expiresTick });
  modifiers.set(key, list);
}

export function producerHealth(region: RegionNode, stocks: ReadonlyMap<SpeciesId, number>, vegetation: number): number {
  const producers = SPECIES.filter((s) => s.tier === 'producer' && s.biomeAffinity.includes(region.biome));
  const pool = producers.length > 0 ? producers : SPECIES.filter((s) => s.tier === 'producer');
  if (pool.length === 0) return 0.5;
  let sum = 0;
  for (const species of pool) {
    const cap = capacityFor(species, region.biome, vegetation);
    sum += Math.min(1, (stocks.get(species.id) ?? 0) / cap);
  }
  return sum / pool.length;
}

export function grazingPressure(region: RegionNode, stocks: ReadonlyMap<SpeciesId, number>, vegetation: number): number {
  const herbivores = SPECIES.filter((s) => s.tier === 'herbivore' && s.biomeAffinity.includes(region.biome));
  if (herbivores.length === 0) return 0.4;
  let sum = 0;
  for (const species of herbivores) {
    const cap = capacityFor(species, region.biome, vegetation);
    sum += Math.min(1.3, (stocks.get(species.id) ?? 0) / cap);
  }
  return sum / herbivores.length;
}
