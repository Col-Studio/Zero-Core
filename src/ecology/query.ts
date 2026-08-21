/**
 * Implements `IEcologyQuery` (services.ts) by reading a live `SimState`. `index.ts` is
 * responsible for keeping that state caught up to `ctx.getTick()` before these are called —
 * queries here never advance the simulation themselves, so they stay cheap (per the interface's
 * "synchronous and cheap" contract).
 */

import type {
  IEcologyQuery,
  PopulationState,
  PressureRecord,
  RegionId,
  SpeciesId,
  Tick,
  TrophicState,
  DeathCause,
} from '@contracts/index';
import { SPECIES, speciesDef } from './species.data';
import type { SimState } from './state';
import { capacityFor } from './population';
import { pressureRecordFor } from './pressure';

export interface EcologyQueryDeps {
  getState(): SimState;
  /** Called for every kill routed through the query's `applyKill` command. */
  onApplyKill(speciesId: SpeciesId, regionId: RegionId, cause: DeathCause): void;
}

function regionOf(state: SimState, regionId: RegionId) {
  return state.regions.find((r) => r.id === regionId);
}

function trendFor(state: SimState, speciesId: SpeciesId, regionId: RegionId, currentStock: number): number {
  const key = `${speciesId}|${regionId}`;
  const past = state.stockHistory.get(key);
  return past === undefined ? 0 : currentStock - past;
}

export function buildEcologyQuery(deps: EcologyQueryDeps): IEcologyQuery {
  const { getState, onApplyKill } = deps;

  return {
    getPopulation(speciesId: SpeciesId, regionId: RegionId): PopulationState {
      const state = getState();
      const region = regionOf(state, regionId);
      const species = speciesDef(speciesId);
      const veg = state.vegetation.get(regionId) ?? 0.5;
      const stock = state.stocks.get(regionId)?.get(speciesId) ?? 0;
      const cap = region === undefined ? 1 : capacityFor(species, region.biome, veg);
      return {
        speciesId,
        regionId,
        stock,
        normalized: cap <= 0 ? 0 : stock / cap,
        carryingCapacity: cap,
        trend: trendFor(state, speciesId, regionId, stock),
      };
    },

    getAllPopulations(regionId: RegionId): readonly PopulationState[] {
      const state = getState();
      const region = regionOf(state, regionId);
      const veg = state.vegetation.get(regionId) ?? 0.5;
      const stocks = state.stocks.get(regionId);
      return SPECIES.map((species) => {
        const stock = stocks?.get(species.id) ?? 0;
        const cap = region === undefined ? 1 : capacityFor(species, region.biome, veg);
        return {
          speciesId: species.id,
          regionId,
          stock,
          normalized: cap <= 0 ? 0 : stock / cap,
          carryingCapacity: cap,
          trend: trendFor(state, species.id, regionId, stock),
        };
      });
    },

    getVegetation(regionId: RegionId): number {
      return getState().vegetation.get(regionId) ?? 0.5;
    },

    getTrophicState(regionId: RegionId): TrophicState {
      const state = getState();
      const region = regionOf(state, regionId);
      const veg = state.vegetation.get(regionId) ?? 0.5;
      const stocks = state.stocks.get(regionId);
      const byTier = { apex: 0, predator: 0, herbivore: 0, producer: 0 };
      const present: SpeciesId[] = [];
      for (const species of SPECIES) {
        const stock = stocks?.get(species.id) ?? 0;
        byTier[species.tier] += stock;
        if (stock > 1) present.push(species.id);
      }
      const cap = region === undefined ? 1 : SPECIES.reduce((sum, s) => sum + capacityFor(s, region.biome, veg), 0);
      const total = byTier.apex + byTier.predator + byTier.herbivore + byTier.producer;
      return {
        regionId,
        byTier,
        vegetation: veg,
        health: Math.max(0, Math.min(1, cap <= 0 ? 0 : total / cap)),
        present,
      };
    },

    getPressure(speciesId: SpeciesId): PressureRecord {
      const state = getState();
      const region = state.regions[0];
      const veg = region === undefined ? 0.5 : state.vegetation.get(region.id) ?? 0.5;
      const cap = region === undefined ? 20 : capacityFor(speciesDef(speciesId), region.biome, veg);
      return pressureRecordFor(state.pressureLedger, speciesId, cap, state.tick);
    },

    applyKill(speciesId: SpeciesId, regionId: RegionId, cause: DeathCause): void {
      onApplyKill(speciesId, regionId, cause);
    },

    getRecentCascades(limit: number): readonly { ruleId: string; tick: Tick; narrative: string; chain: readonly string[]; regionId: RegionId }[] {
      const state = getState();
      const slice = state.cascadeLog.slice(-limit).reverse();
      return slice.map((c) => ({ ruleId: c.ruleId, tick: c.tick, narrative: c.narrative, chain: c.chain, regionId: c.regionId }));
    },

    getSpeciesList() {
      return SPECIES.map((s) => ({ id: s.id, name: s.name, tier: s.tier, diet: s.dietOf, predators: s.preyedOnBy }));
    },
  };
}
