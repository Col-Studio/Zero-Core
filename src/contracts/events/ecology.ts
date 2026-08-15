/**
 * FROZEN — integration lead only. See CLAUDE.md § Frozen files.
 *
 * Ecology events — the nature-rules vocabulary. Owned by `ecology`.
 */

import type { RegionId, SpeciesId } from '../ids';

/** Population is a normalised 0..1 fraction of the region's carrying capacity for the species. */
export interface PopulationChanged {
  type: 'population:changed';
  speciesId: SpeciesId;
  regionId: RegionId;
  /** Head count, rounded from the continuous stock. */
  count: number;
  /** Signed change since the last emit for this species+region. */
  delta: number;
  /** 0..1 fraction of carrying capacity. */
  normalized: number;
}

/** Vegetation density 0..1. `world` thins its instanced foliage from this. */
export interface VegetationChanged {
  type: 'vegetation:changed';
  regionId: RegionId;
  density: number;
  delta: number;
}

/**
 * A nature rule fired. THE headline event of the game: `chain` is the causal path and
 * `narrative` is the player-facing sentence. `society` turns these into missions and
 * `presentation` renders them in the chronicle.
 */
export interface CascadeTriggered {
  type: 'cascade:triggered';
  ruleId: string;
  regionId: RegionId;
  /** Rule ids that led here, oldest first — the causal chain to display. */
  chain: string[];
  narrative: string;
  /** How far-reaching this is, for UI prominence. */
  severity: 'minor' | 'notable' | 'major' | 'catastrophic';
  /** Species the player pressured to cause this, if attributable. */
  blamedSpecies?: SpeciesId;
}

/** A species is moving into a region — `creatures` spawns the actual bodies in response. */
export interface SpeciesMigrating {
  type: 'species:migrating';
  speciesId: SpeciesId;
  fromRegion: RegionId | null;
  toRegion: RegionId;
  /** Head count arriving. */
  count: number;
  reason: 'niche-vacant' | 'overcrowding' | 'famine' | 'disaster' | 'season';
}

export interface SpeciesExtinct {
  type: 'species:extinct';
  speciesId: SpeciesId;
  /** null = globally extinct, otherwise extinct in this region only. */
  regionId: RegionId | null;
  /** True when player pressure was the dominant cause. */
  playerCaused: boolean;
}

export type EcologyEvent =
  | PopulationChanged
  | VegetationChanged
  | CascadeTriggered
  | SpeciesMigrating
  | SpeciesExtinct;
