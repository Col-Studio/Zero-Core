/**
 * Damped coupled-logistic population model tuning. All numbers here, never inline in
 * population.ts (CLAUDE.md § Hard invariant 9).
 *
 * The model is Lotka-Volterra-*flavoured* — logistic growth toward a carrying capacity, a
 * type-II (saturating) functional response for predation, and a starvation term — but every
 * term is explicitly damped and clamped. Real Lotka-Volterra oscillates without bound; an
 * unplayable world is a failed feature (per the card), so:
 *   • growth is logistic (self-limiting) for every tier, not just producers
 *   • predation uses a saturating functional response, not linear mass-action, so predators
 *     can't crash prey to zero in one tick
 *   • net change per tick is hard-capped as a fraction of current stock (MAX_FRACTIONAL_DELTA)
 *   • stock is clamped to [0, capacity * OVERSHOOT_CAP]
 * Tune on fast-forward (16x = advance 16 ticks worth of sim per displayed frame in the
 * dashboard), verify at 1x — see dev/Dashboard.tsx.
 */

import type { TrophicTier } from '@contracts/index';

/** Baseline carrying capacity per tier before species multiplier and biome affinity. */
export const TIER_BASE_CAPACITY: Readonly<Record<TrophicTier, number>> = {
  producer: 1000,
  herbivore: 150,
  predator: 35,
  apex: 8,
};

/** How much a region's biome mismatch shrinks a species' capacity there. Affinity biome = 1.0. */
export const OFF_BIOME_CAPACITY_FACTOR = 0.12;

/** Type-II functional response half-saturation, as a fraction of prey carrying capacity. */
export const HALF_SATURATION_FRACTION = 0.35;

/** Hunt efficiency: fraction of a predator's max intake actually converted per tick at satiation. */
export const HUNT_EFFICIENCY = 0.05;

/** No species may change stock by more than this fraction of itself in one tick. The damper. */
export const MAX_FRACTIONAL_DELTA = 0.01;

/** Stock may briefly overshoot capacity (a population boom) but never past this multiple. */
export const OVERSHOOT_CAP = 1.35;

/** Below this fraction of dietary need being met, starvation kicks in above baseline. */
export const FOOD_SUFFICIENCY_THRESHOLD = 0.55;
export const STARVATION_SHORTAGE_GAIN = 2.2;

/** Floor stock below which a species is treated as locally extinct for migration purposes. */
export const EXTINCTION_FLOOR = 0.15;

/** Vegetation feeds producer-tier capacity: producers ARE the vegetation's living stock. */
export const PRODUCER_VEGETATION_COUPLING = 0.6;

/** Migration pressure: overcrowding above this normalized level nudges emigration. */
export const OVERCROWDING_THRESHOLD = 0.92;
