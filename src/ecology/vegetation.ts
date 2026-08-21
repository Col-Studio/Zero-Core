/**
 * Per-region vegetation density, 0..1. Driven by grazing pressure, water, season, and fire
 * (card point 5). Coupled to, but distinct from, producer-tier species stocks in population.ts —
 * vegetation is the *land's* capacity to support plant life; producer species are specific
 * plants growing on it. Each tick: population.ts reads last tick's density to size producer
 * capacity, then this module advances density using this tick's producer health and grazing load.
 */

import type { BiomeKind } from '@contracts/index';
import type { SeasonModifiers } from './seasons.data';
import {
  BASE_VEGETATION_BY_BIOME,
  FIRE_FERTILIZATION_MULT,
  FIRE_FERTILIZATION_TICKS,
  FIRE_LOSS_FRACTION,
  GRAZING_PRESSURE_WEIGHT,
  REGROWTH_RATE,
  WATER_WEIGHT,
} from './vegetation.data';

export interface VegetationInput {
  biome: BiomeKind;
  current: number;
  /** 0..1 average normalized stock of producer species present in the region. */
  producerHealth: number;
  /** 0..1 normalized herbivore load — how hard the region is being grazed. */
  grazingPressure: number;
  /** 0..1, from IWorldQuery.getBiomeAt().waterAvailability (or a default for headless runs). */
  waterAvailability: number;
  season: SeasonModifiers;
  /** True on the exact tick a fire nature-rule effect fires. */
  fireNow: boolean;
  /** Ticks remaining of post-fire ash fertilization, if any. */
  fireFertilizationTicksLeft: number;
}

export interface VegetationResult {
  density: number;
  fireFertilizationTicksLeft: number;
}

export function stepVegetation(input: VegetationInput): VegetationResult {
  const base = BASE_VEGETATION_BY_BIOME[input.biome];
  const waterFactor = 1 - WATER_WEIGHT + WATER_WEIGHT * input.waterAvailability;
  const grazingPenalty = GRAZING_PRESSURE_WEIGHT * Math.max(0, input.grazingPressure - 0.5) * 2;
  const target = Math.max(
    0.03,
    Math.min(1, base * waterFactor * (0.4 + 0.6 * input.producerHealth) - grazingPenalty),
  );

  const fertilized = input.fireFertilizationTicksLeft > 0;
  const rate = REGROWTH_RATE * input.season.vegetationGrowth * (fertilized ? FIRE_FERTILIZATION_MULT : 1);

  let density = input.current + (target - input.current) * rate;
  let fireTicksLeft = Math.max(0, input.fireFertilizationTicksLeft - 1);

  if (input.fireNow) {
    density = Math.max(0.02, density * (1 - FIRE_LOSS_FRACTION));
    fireTicksLeft = FIRE_FERTILIZATION_TICKS;
  }

  return { density: Math.max(0, Math.min(1, density)), fireFertilizationTicksLeft: fireTicksLeft };
}
