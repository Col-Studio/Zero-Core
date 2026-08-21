/**
 * The trophic web — DATA, not code (CLAUDE.md § Hard invariant 9).
 *
 * 24 species across 4 tiers. `diet` / `predators` are the edges of the food web; every edge
 * must be mutually consistent (checked in tests/ecology/rulesEngine.test.ts). Rates below are
 * PER TICK (1 tick = 1/20 s) and tuned so that, left alone, populations breathe gently on a
 * multi-minute cycle instead of flatlining, and a sustained kill campaign visibly bends the
 * curve within 10-20 minutes of play (12 000-24 000 ticks) — see population.data.ts for the
 * shared damping constants that make this stable rather than a diverging Lotka-Volterra system.
 */

import { speciesId, type SpeciesId, type BiomeKind, type TrophicTier } from '@contracts/index';

export interface SpeciesDef {
  id: SpeciesId;
  name: string;
  tier: TrophicTier;
  /** Species this one eats. Empty for producers, which grow from sun/soil instead. */
  dietOf: SpeciesId[];
  /** Species that eat this one. Kept in sync with `dietOf` by a startup assertion. */
  preyedOnBy: SpeciesId[];
  /** Per-tick intrinsic growth rate at low density, before any coupling. */
  reproductionRate: number;
  /** Per-tick starvation rate applied when food is scarce. */
  starvationRate: number;
  /** Biomes this species can maintain a population in. */
  biomeAffinity: BiomeKind[];
  /** Multiplies the tier's baseline carrying capacity for this species. */
  carryingCapacityMultiplier: number;
  /** Normalized population (0..1) below which a niche is considered vacant for migration. */
  migrationThreshold: number;
  /** Losing this species silently restructures the region (nature-rules engine leans on this). */
  keystone: boolean;
  /** Scavengers track total death rate rather than live prey biomass. */
  scavenger?: boolean;
}

const S = {
  meadowGrass: speciesId('meadow_grass'),
  berryShrub: speciesId('berry_shrub'),
  wetlandReed: speciesId('wetland_reed'),
  alpineMoss: speciesId('alpine_moss'),
  thornbrush: speciesId('thornbrush'),
  ashfern: speciesId('ashfern'),
  lakeAlgae: speciesId('lake_algae'),

  redDeer: speciesId('red_deer'),
  hare: speciesId('hare'),
  wildBoar: speciesId('wild_boar'),
  marshElk: speciesId('marsh_elk'),
  mountainGoat: speciesId('mountain_goat'),
  dustAntelope: speciesId('dust_antelope'),
  meadowBee: speciesId('meadow_bee'),
  lakeFish: speciesId('lake_fish'),

  greyWolf: speciesId('grey_wolf'),
  lynx: speciesId('lynx'),
  riverOtter: speciesId('river_otter'),
  desertJackal: speciesId('desert_jackal'),
  carrionCrow: speciesId('carrion_crow'),
  marshHeron: speciesId('marsh_heron'),
  alpineFalcon: speciesId('alpine_falcon'),

  direWolf: speciesId('dire_wolf'),
  caveBear: speciesId('cave_bear'),
  swampWyrm: speciesId('swamp_wyrm'),
} as const;

export const SPECIES_IDS = S;

const ALL_BIOMES: BiomeKind[] = ['meadow', 'forest', 'alpine', 'wetland', 'badlands', 'ashland'];

/** Convenience — filled in below by `link()`. Kept mutable only inside this module. */
const defs = new Map<SpeciesId, SpeciesDef>();

function def(d: Omit<SpeciesDef, 'preyedOnBy'>): void {
  defs.set(d.id, { ...d, preyedOnBy: [] });
}

// ---- producers -------------------------------------------------------------------------------
def({ id: S.meadowGrass, name: 'Meadow Grass', tier: 'producer', dietOf: [], reproductionRate: 0.0090, starvationRate: 0, biomeAffinity: ['meadow', 'forest'], carryingCapacityMultiplier: 1.4, migrationThreshold: 0.1, keystone: false });
def({ id: S.berryShrub, name: 'Berry Shrub', tier: 'producer', dietOf: [], reproductionRate: 0.0035, starvationRate: 0, biomeAffinity: ['forest', 'meadow'], carryingCapacityMultiplier: 0.6, migrationThreshold: 0.08, keystone: true });
def({ id: S.wetlandReed, name: 'Wetland Reed', tier: 'producer', dietOf: [], reproductionRate: 0.0075, starvationRate: 0, biomeAffinity: ['wetland'], carryingCapacityMultiplier: 1.1, migrationThreshold: 0.1, keystone: false });
def({ id: S.alpineMoss, name: 'Alpine Moss', tier: 'producer', dietOf: [], reproductionRate: 0.0028, starvationRate: 0, biomeAffinity: ['alpine'], carryingCapacityMultiplier: 0.7, migrationThreshold: 0.08, keystone: false });
def({ id: S.thornbrush, name: 'Thornbrush', tier: 'producer', dietOf: [], reproductionRate: 0.0022, starvationRate: 0, biomeAffinity: ['badlands'], carryingCapacityMultiplier: 0.5, migrationThreshold: 0.06, keystone: false });
def({ id: S.ashfern, name: 'Ashfern', tier: 'producer', dietOf: [], reproductionRate: 0.0060, starvationRate: 0, biomeAffinity: ['ashland', 'badlands'], carryingCapacityMultiplier: 0.4, migrationThreshold: 0.05, keystone: false });
def({ id: S.lakeAlgae, name: 'Lake Algae', tier: 'producer', dietOf: [], reproductionRate: 0.0120, starvationRate: 0, biomeAffinity: ['wetland'], carryingCapacityMultiplier: 0.9, migrationThreshold: 0.1, keystone: false });

// ---- herbivores -------------------------------------------------------------------------------
def({ id: S.redDeer, name: 'Red Deer', tier: 'herbivore', dietOf: [S.meadowGrass, S.berryShrub], reproductionRate: 0.0016, starvationRate: 0.0020, biomeAffinity: ['meadow', 'forest'], carryingCapacityMultiplier: 1.0, migrationThreshold: 0.12, keystone: false });
def({ id: S.hare, name: 'Hare', tier: 'herbivore', dietOf: [S.meadowGrass], reproductionRate: 0.0032, starvationRate: 0.0026, biomeAffinity: ['meadow', 'forest'], carryingCapacityMultiplier: 1.5, migrationThreshold: 0.12, keystone: false });
def({ id: S.wildBoar, name: 'Wild Boar', tier: 'herbivore', dietOf: [S.berryShrub, S.meadowGrass], reproductionRate: 0.0018, starvationRate: 0.0018, biomeAffinity: ['forest'], carryingCapacityMultiplier: 0.7, migrationThreshold: 0.12, keystone: false });
def({ id: S.marshElk, name: 'Marsh Elk', tier: 'herbivore', dietOf: [S.wetlandReed], reproductionRate: 0.0014, starvationRate: 0.0018, biomeAffinity: ['wetland'], carryingCapacityMultiplier: 0.8, migrationThreshold: 0.12, keystone: false });
def({ id: S.mountainGoat, name: 'Mountain Goat', tier: 'herbivore', dietOf: [S.alpineMoss], reproductionRate: 0.0013, starvationRate: 0.0017, biomeAffinity: ['alpine'], carryingCapacityMultiplier: 0.7, migrationThreshold: 0.12, keystone: false });
def({ id: S.dustAntelope, name: 'Dust Antelope', tier: 'herbivore', dietOf: [S.thornbrush], reproductionRate: 0.0015, starvationRate: 0.0022, biomeAffinity: ['badlands'], carryingCapacityMultiplier: 0.6, migrationThreshold: 0.1, keystone: false });
def({ id: S.meadowBee, name: 'Meadow Bee', tier: 'herbivore', dietOf: [S.berryShrub], reproductionRate: 0.0040, starvationRate: 0.0030, biomeAffinity: ['meadow', 'forest'], carryingCapacityMultiplier: 1.2, migrationThreshold: 0.15, keystone: true });
def({ id: S.lakeFish, name: 'Lake Fish', tier: 'herbivore', dietOf: [S.lakeAlgae], reproductionRate: 0.0026, starvationRate: 0.0020, biomeAffinity: ['wetland'], carryingCapacityMultiplier: 1.1, migrationThreshold: 0.1, keystone: false });

// ---- predators (mesopredators) -----------------------------------------------------------------
def({ id: S.greyWolf, name: 'Grey Wolf', tier: 'predator', dietOf: [S.redDeer, S.hare, S.wildBoar], reproductionRate: 0.0009, starvationRate: 0.0022, biomeAffinity: ['forest', 'meadow'], carryingCapacityMultiplier: 0.5, migrationThreshold: 0.15, keystone: true });
def({ id: S.lynx, name: 'Lynx', tier: 'predator', dietOf: [S.hare, S.mountainGoat], reproductionRate: 0.0008, starvationRate: 0.0020, biomeAffinity: ['forest', 'alpine'], carryingCapacityMultiplier: 0.4, migrationThreshold: 0.15, keystone: false });
def({ id: S.riverOtter, name: 'River Otter', tier: 'predator', dietOf: [S.lakeFish], reproductionRate: 0.0011, starvationRate: 0.0020, biomeAffinity: ['wetland'], carryingCapacityMultiplier: 0.5, migrationThreshold: 0.15, keystone: false });
def({ id: S.desertJackal, name: 'Desert Jackal', tier: 'predator', dietOf: [S.dustAntelope], reproductionRate: 0.0010, starvationRate: 0.0024, biomeAffinity: ['badlands', 'ashland'], carryingCapacityMultiplier: 0.4, migrationThreshold: 0.12, keystone: false });
def({ id: S.carrionCrow, name: 'Carrion Crow', tier: 'predator', dietOf: [], reproductionRate: 0.0018, starvationRate: 0.0010, biomeAffinity: ALL_BIOMES, carryingCapacityMultiplier: 0.5, migrationThreshold: 0.05, keystone: false, scavenger: true });
def({ id: S.marshHeron, name: 'Marsh Heron', tier: 'predator', dietOf: [S.lakeFish], reproductionRate: 0.0010, starvationRate: 0.0020, biomeAffinity: ['wetland'], carryingCapacityMultiplier: 0.35, migrationThreshold: 0.15, keystone: false });
def({ id: S.alpineFalcon, name: 'Alpine Falcon', tier: 'predator', dietOf: [S.hare], reproductionRate: 0.0009, starvationRate: 0.0020, biomeAffinity: ['alpine'], carryingCapacityMultiplier: 0.3, migrationThreshold: 0.15, keystone: false });

// ---- apex ---------------------------------------------------------------------------------------
def({ id: S.direWolf, name: 'Dire Wolf', tier: 'apex', dietOf: [S.redDeer, S.greyWolf], reproductionRate: 0.0004, starvationRate: 0.0018, biomeAffinity: ['forest', 'alpine'], carryingCapacityMultiplier: 0.15, migrationThreshold: 0.2, keystone: true });
def({ id: S.caveBear, name: 'Cave Bear', tier: 'apex', dietOf: [S.mountainGoat, S.redDeer, S.lynx], reproductionRate: 0.0003, starvationRate: 0.0016, biomeAffinity: ['alpine', 'forest'], carryingCapacityMultiplier: 0.12, migrationThreshold: 0.2, keystone: true });
def({ id: S.swampWyrm, name: 'Swamp Wyrm', tier: 'apex', dietOf: [S.marshElk, S.riverOtter], reproductionRate: 0.0003, starvationRate: 0.0016, biomeAffinity: ['wetland', 'ashland'], carryingCapacityMultiplier: 0.1, migrationThreshold: 0.2, keystone: true });

// Back-fill `preyedOnBy` from `dietOf` so the graph is always mutually consistent.
for (const predator of defs.values()) {
  for (const preyId of predator.dietOf) {
    const prey = defs.get(preyId);
    if (prey !== undefined) prey.preyedOnBy.push(predator.id);
  }
}

export const SPECIES: readonly SpeciesDef[] = [...defs.values()];
export const SPECIES_BY_ID: ReadonlyMap<SpeciesId, SpeciesDef> = defs;

export function speciesDef(id: SpeciesId): SpeciesDef {
  const s = defs.get(id);
  if (s === undefined) throw new Error(`ecology: unknown species '${id}'`);
  return s;
}

export const KEYSTONE_SPECIES: readonly SpeciesId[] = SPECIES.filter((s) => s.keystone).map(
  (s) => s.id,
);
