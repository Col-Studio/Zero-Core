/**
 * The population model. One pure function, `stepRegionPopulations`, advances every species'
 * stock in one region by one tick. See population.data.ts for the tuning constants and the
 * damping rationale.
 *
 * Deliberately intra-region: predator/prey coupling happens within a region's own stocks.
 * Cross-region effects (migration, niche-filling) are a separate mechanism — see migration.ts —
 * so this function stays a small, fast, allocation-light hot loop.
 */

import type { BiomeKind, SpeciesId } from '@contracts/index';
import type { SeasonModifiers } from './seasons.data';
import { SPECIES, speciesDef, type SpeciesDef } from './species.data';
import {
  EXTINCTION_FLOOR,
  FOOD_SUFFICIENCY_THRESHOLD,
  HALF_SATURATION_FRACTION,
  HUNT_EFFICIENCY,
  MAX_FRACTIONAL_DELTA,
  OFF_BIOME_CAPACITY_FACTOR,
  OVERSHOOT_CAP,
  PRODUCER_VEGETATION_COUPLING,
  STARVATION_SHORTAGE_GAIN,
  TIER_BASE_CAPACITY,
} from './population.data';

export function biomeAffinityFactor(species: SpeciesDef, biome: BiomeKind): number {
  return species.biomeAffinity.includes(biome) ? 1 : OFF_BIOME_CAPACITY_FACTOR;
}

/** Carrying capacity for one species in one region right now. Cheap — safe to call per tick. */
export function capacityFor(species: SpeciesDef, biome: BiomeKind, vegetationDensity: number): number {
  const base = TIER_BASE_CAPACITY[species.tier] * species.carryingCapacityMultiplier;
  const affinity = biomeAffinityFactor(species, biome);
  const vegFactor =
    species.tier === 'producer'
      ? 1 - PRODUCER_VEGETATION_COUPLING + PRODUCER_VEGETATION_COUPLING * vegetationDensity
      : 1;
  return Math.max(0.5, base * affinity * vegFactor);
}

export interface RegionPopInput {
  biome: BiomeKind;
  vegetationDensity: number;
  season: SeasonModifiers;
  /** Current stock per species (only species present in the region need entries; missing = 0). */
  stocks: ReadonlyMap<SpeciesId, number>;
  /** Recent deaths-per-tick across the region, all causes — feeds scavenger growth. */
  recentDeathRate: number;
  /** Temporary reproduction-rate multipliers from active nature-rule effects, keyed by species. */
  rateMultipliers?: ReadonlyMap<SpeciesId, number>;
}

const stockOf = (stocks: ReadonlyMap<SpeciesId, number>, id: SpeciesId): number => stocks.get(id) ?? 0;

/** 0..1 how well a consumer's dietary need is being met, given its prey's relative abundance. */
function foodSufficiency(species: SpeciesDef, biome: BiomeKind, veg: number, stocks: ReadonlyMap<SpeciesId, number>): number {
  if (species.dietOf.length === 0) return 1;
  let sum = 0;
  for (const preyId of species.dietOf) {
    const prey = speciesDef(preyId);
    const cap = capacityFor(prey, biome, veg);
    sum += Math.min(1, stockOf(stocks, preyId) / cap);
  }
  return sum / species.dietOf.length;
}

export interface RegionPopResult {
  stocks: Map<SpeciesId, number>;
  /** Sum of predation + starvation losses across all species this tick — feeds scavengers. */
  mortality: number;
}

/** Advance every species' stock in one region by exactly one simulation tick. Pure, no I/O. */
export function stepRegionPopulations(input: RegionPopInput): RegionPopResult {
  const { biome, vegetationDensity, season, stocks, recentDeathRate, rateMultipliers } = input;
  const next = new Map<SpeciesId, number>();
  let mortality = 0;

  for (const species of SPECIES) {
    const N = stockOf(stocks, species.id);
    const K = capacityFor(species, biome, vegetationDensity);
    const rateMult = rateMultipliers?.get(species.id) ?? 1;

    let growth: number;
    if (species.scavenger === true) {
      // Scavengers track total death rate rather than live prey biomass (card point 3).
      const carrionSupply = Math.min(1.5, recentDeathRate * 40);
      growth = species.reproductionRate * season.reproduction * rateMult * N * (1 - N / K) * (0.3 + carrionSupply);
    } else {
      growth = species.reproductionRate * season.reproduction * rateMult * N * Math.max(0, 1 - N / K);
      if (species.dietOf.length > 0) {
        const sufficiency = foodSufficiency(species, biome, vegetationDensity, stocks);
        growth *= Math.min(1, sufficiency / FOOD_SUFFICIENCY_THRESHOLD);
      }
    }

    let predationLoss = 0;
    for (const predatorId of species.preyedOnBy) {
      const predatorStock = stockOf(stocks, predatorId);
      if (predatorStock <= 0) continue;
      const halfSat = Math.max(1, K * HALF_SATURATION_FRACTION);
      predationLoss += HUNT_EFFICIENCY * predatorStock * (N / (N + halfSat));
    }

    let starvationLoss = species.starvationRate * season.starvation * N;
    if (species.dietOf.length > 0) {
      const sufficiency = foodSufficiency(species, biome, vegetationDensity, stocks);
      if (sufficiency < FOOD_SUFFICIENCY_THRESHOLD) {
        const shortage = FOOD_SUFFICIENCY_THRESHOLD - sufficiency;
        starvationLoss += species.starvationRate * season.starvation * N * shortage * STARVATION_SHORTAGE_GAIN;
      }
    }
    mortality += predationLoss + starvationLoss;

    const rawNet = growth - predationLoss - starvationLoss;
    const maxDelta = MAX_FRACTIONAL_DELTA * Math.max(N, K * 0.02);
    const net = Math.max(-maxDelta, Math.min(maxDelta, rawNet));

    let newStock = N + net;
    if (newStock < EXTINCTION_FLOOR * 0.2) newStock = Math.max(0, newStock);
    newStock = Math.max(0, Math.min(newStock, K * OVERSHOOT_CAP));
    next.set(species.id, newStock);
  }

  return { stocks: next, mortality };
}

export function isLocallyExtinct(species: SpeciesDef, biome: BiomeKind, veg: number, stock: number): boolean {
  const K = capacityFor(species, biome, veg);
  return stock <= EXTINCTION_FLOOR * 0.2 || stock / K < 0.01;
}
