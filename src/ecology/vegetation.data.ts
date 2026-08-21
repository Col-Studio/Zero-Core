import type { BiomeKind } from '@contracts/index';

/** Baseline vegetation density a biome settles at with no grazing pressure. */
export const BASE_VEGETATION_BY_BIOME: Readonly<Record<BiomeKind, number>> = {
  meadow: 0.75,
  forest: 0.9,
  alpine: 0.4,
  wetland: 0.7,
  badlands: 0.2,
  ashland: 0.12,
};

/** How quickly density chases its target per tick. Small — vegetation changes slowly. */
export const REGROWTH_RATE = 0.006;

/** How much grazing pressure (normalized herbivore load) can suppress the target density. */
export const GRAZING_PRESSURE_WEIGHT = 0.55;

export const WATER_WEIGHT = 0.35;

/** A fire event removes this fraction of standing vegetation instantly. */
export const FIRE_LOSS_FRACTION = 0.7;

/** After a fire, regrowth rate is boosted (ash fertilization) for this many ticks. */
export const FIRE_FERTILIZATION_TICKS = 4_000;
export const FIRE_FERTILIZATION_MULT = 2.4;

/** Vegetation below this floor is treated as "collapsed" for rule conditions. */
export const VEGETATION_COLLAPSE_THRESHOLD = 0.15;

/** Default water availability per biome, used until `world` (the real owner) is merged. */
export const DEFAULT_WATER_AVAILABILITY: Readonly<Record<BiomeKind, number>> = {
  meadow: 0.55,
  forest: 0.65,
  alpine: 0.4,
  wetland: 0.95,
  badlands: 0.15,
  ashland: 0.1,
};
