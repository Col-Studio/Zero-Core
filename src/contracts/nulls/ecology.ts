/**
 * FROZEN — integration lead only. See CLAUDE.md § Frozen files.
 *
 * Null ecology. A tiny 8-species trophic web whose populations drift on slow deterministic
 * curves and respond weakly to kills.
 *
 * Deliberately NOT a real cascade engine — that's Member 3's job. But it must be plausible
 * enough that `world` can thin its forests, `society` can starve a village, and `presentation`
 * can graph something interesting, all before Member 3 has written a line.
 */

import type { IEcologyQuery, PopulationState, PressureRecord, TrophicState } from '../services';
import {
  speciesId as toSpeciesId,
  type DeathCause,
  type RegionId,
  type SpeciesId,
  type Tick,
  type TrophicTier,
} from '../ids';
import { hashString } from '../rng';

interface NullSpecies {
  id: SpeciesId;
  name: string;
  tier: TrophicTier;
  diet: SpeciesId[];
  predators: SpeciesId[];
  capacity: number;
}

const S = {
  grass: toSpeciesId('grass'),
  berry: toSpeciesId('berry_shrub'),
  bee: toSpeciesId('bee'),
  deer: toSpeciesId('deer'),
  hare: toSpeciesId('hare'),
  boar: toSpeciesId('boar'),
  wolf: toSpeciesId('wolf'),
  lynx: toSpeciesId('lynx'),
  direbear: toSpeciesId('dire_bear'),
} as const;

/** Shared by the Nulls and usable as a starting point by Member 3. */
export const NULL_SPECIES: readonly NullSpecies[] = [
  { id: S.grass, name: 'Meadow Grass', tier: 'producer', diet: [], predators: [S.deer, S.hare], capacity: 1000 },
  { id: S.berry, name: 'Berry Shrub', tier: 'producer', diet: [], predators: [S.boar, S.bee], capacity: 400 },
  { id: S.bee, name: 'Meadow Bee', tier: 'producer', diet: [S.berry], predators: [], capacity: 600 },
  { id: S.deer, name: 'Red Deer', tier: 'herbivore', diet: [S.grass], predators: [S.wolf, S.direbear], capacity: 120 },
  { id: S.hare, name: 'Hare', tier: 'herbivore', diet: [S.grass], predators: [S.lynx, S.wolf], capacity: 200 },
  { id: S.boar, name: 'Wild Boar', tier: 'herbivore', diet: [S.berry], predators: [S.wolf], capacity: 80 },
  { id: S.wolf, name: 'Grey Wolf', tier: 'predator', diet: [S.deer, S.hare, S.boar], predators: [S.direbear], capacity: 30 },
  { id: S.lynx, name: 'Lynx', tier: 'predator', diet: [S.hare], predators: [], capacity: 18 },
  { id: S.direbear, name: 'Dire Bear', tier: 'apex', diet: [S.deer, S.wolf], predators: [], capacity: 6 },
];

const BY_ID = new Map<string, NullSpecies>(NULL_SPECIES.map((s) => [s.id, s]));

/**
 * Slow deterministic drift as a function of tick. Two out-of-phase sines give populations that
 * move without ever collapsing, so consumers see live data but never an empty world.
 */
function driftFraction(speciesId: SpeciesId, regionId: RegionId, tick: Tick): number {
  const phase = (hashString(`${speciesId}|${regionId}`) % 1000) / 1000;
  const slow = Math.sin(tick / 6000 + phase * Math.PI * 2);
  const fast = Math.sin(tick / 1300 + phase * 11);
  return 0.62 + 0.18 * slow + 0.06 * fast; // stays inside ~0.38..0.86
}

export function createNullEcologyQuery(getTick: () => Tick = () => 0): IEcologyQuery {
  /** Player kills, keyed `species|region`. The Null still "remembers" — weakly. */
  const kills = new Map<string, number>();
  const lastKillTick = new Map<string, Tick>();

  const killsFor = (speciesId: SpeciesId): { total: number; byRegion: Record<string, number> } => {
    let total = 0;
    const byRegion: Record<string, number> = {};
    for (const [key, count] of kills) {
      const [sid, rid] = key.split('|');
      if (sid !== speciesId) continue;
      total += count;
      if (rid !== undefined) byRegion[rid] = (byRegion[rid] ?? 0) + count;
    }
    return { total, byRegion };
  };

  const populationOf = (speciesId: SpeciesId, regionId: RegionId): PopulationState => {
    const species = BY_ID.get(speciesId);
    const capacity = species?.capacity ?? 50;
    const killed = kills.get(`${speciesId}|${regionId}`) ?? 0;

    // Each kill removes a slice of the population and recovers slowly. Enough for consumers to
    // observe that killing things matters.
    const pressure = Math.min(0.8, killed / Math.max(4, capacity * 0.5));
    const normalized = Math.max(0.02, driftFraction(speciesId, regionId, getTick()) - pressure);

    return {
      speciesId,
      regionId,
      stock: normalized * capacity,
      normalized,
      carryingCapacity: capacity,
      trend: Math.cos(getTick() / 6000) * 0.02,
    };
  };

  const vegetationOf = (regionId: RegionId): number => {
    // Producers average, pushed down by herbivore load — a crude version of the real coupling.
    const grass = populationOf(S.grass, regionId).normalized;
    const berry = populationOf(S.berry, regionId).normalized;
    const deer = populationOf(S.deer, regionId).normalized;
    return Math.max(0.05, Math.min(1, (grass + berry) / 2 - (deer - 0.6) * 0.3));
  };

  return {
    getPopulation: populationOf,

    getAllPopulations(regionId) {
      return NULL_SPECIES.map((s) => populationOf(s.id, regionId));
    },

    getVegetation: vegetationOf,

    getTrophicState(regionId): TrophicState {
      const byTier: Record<TrophicTier, number> = {
        apex: 0,
        predator: 0,
        herbivore: 0,
        producer: 0,
      };
      const present: SpeciesId[] = [];
      for (const s of NULL_SPECIES) {
        const pop = populationOf(s.id, regionId);
        byTier[s.tier] += pop.stock;
        if (pop.normalized > 0.05) present.push(s.id);
      }
      const vegetation = vegetationOf(regionId);
      // Health penalises missing tiers — a region with no predators is not healthy.
      const tiers = [byTier.apex > 0, byTier.predator > 0, byTier.herbivore > 0, vegetation > 0.2];
      const health = tiers.filter(Boolean).length / tiers.length;
      return { regionId, byTier, vegetation, health, present };
    },

    getPressure(speciesId): PressureRecord {
      const { total, byRegion } = killsFor(speciesId);
      const capacity = BY_ID.get(speciesId)?.capacity ?? 50;
      let last: Tick = 0;
      for (const [key, tick] of lastKillTick) {
        if (key.startsWith(`${speciesId}|`) && tick > last) last = tick;
      }
      return {
        speciesId,
        totalKills: total,
        killsByRegion: byRegion,
        pressure: Math.min(1, total / Math.max(4, capacity * 0.5)),
        lastKillTick: last,
      };
    },

    applyKill(speciesId, regionId, cause: DeathCause) {
      if (cause !== 'player') return; // only player pressure is "remembered"
      const key = `${speciesId}|${regionId}`;
      kills.set(key, (kills.get(key) ?? 0) + 1);
      lastKillTick.set(key, getTick());
    },

    // The Null fires no rules — cascades are Member 3's deliverable. Consumers must handle an
    // empty chronicle gracefully, and this is what proves they do.
    getRecentCascades() {
      return [];
    },

    getSpeciesList() {
      return NULL_SPECIES.map((s) => ({
        id: s.id,
        name: s.name,
        tier: s.tier,
        diet: s.diet,
        predators: s.predators,
      }));
    },
  };
}
