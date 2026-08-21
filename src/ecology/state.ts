/**
 * The full simulation state. Deliberately plain data (Maps/arrays/numbers, no functions, no RNG,
 * no service references) so it is directly hashable via `hashState` and trivially
 * serializable for save/load — including a pending delayed rule effect mid-cascade, which is
 * exactly what tests/ecology/determinism.test.ts exercises.
 */

import { hashState, type RegionId, type SpeciesId, type Tick, type WeatherKind } from '@contracts/index';
import type { Rng } from '@contracts/index';
import { SPECIES, type SpeciesDef } from './species.data';
import { syntheticRegions, type RegionNode } from './regions';
import { createPressureLedger, deserializeLedger, serializeLedger, type PressureCell, type PressureLedger } from './pressure';
import { createRuleRuntimeState, type RuleRuntimeCell, type RuleRuntimeState } from './rulesEngine';
import type { MigrationQueue, MigrationTask, WorldStocks } from './migration';
import { capacityFor } from './population';

export interface ActiveRateModifier {
  multiplier: number;
  expiresTick: Tick;
}

export interface CascadeLogEntry {
  tick: Tick;
  ruleId: string;
  regionId: RegionId;
  chain: string[];
  narrative: string;
  severity: string;
  blamedSpecies?: SpeciesId;
}

export const CASCADE_LOG_CAP = 500;
export const RECENT_FIRED_WINDOW_TICKS = 6_000;

export interface SimState {
  tick: Tick;
  regions: RegionNode[];
  stocks: WorldStocks;
  vegetation: Map<RegionId, number>;
  fireFertilizationTicksLeft: Map<RegionId, number>;
  /** Keyed `${speciesId}|${regionId}`. */
  activeRateModifiers: Map<string, ActiveRateModifier[]>;
  pressureLedger: PressureLedger;
  ruleRuntime: RuleRuntimeState;
  migrationQueue: MigrationQueue;
  cascadeLog: CascadeLogEntry[];
  /** `${ruleId}@${tick}` per region, pruned to RECENT_FIRED_WINDOW_TICKS — feeds rule chains. */
  recentFiredByRegion: Map<RegionId, { ruleId: string; tick: Tick }[]>;
  weather: WeatherKind;
  extinctSpecies: Set<string>;
  /** Decaying flux of recent deaths per region, all causes — feeds scavenger growth. */
  recentDeathRate: Map<RegionId, number>;
  /** Stock snapshot taken every 1000 ticks, keyed `${speciesId}|${regionId}` — powers `trend`. */
  stockHistory: Map<string, number>;
}

export function createInitialState(regions: RegionNode[], rng: Rng): SimState {
  const stocks: WorldStocks = new Map();
  const vegetation = new Map<RegionId, number>();
  const fireFertilizationTicksLeft = new Map<RegionId, number>();

  for (const region of regions) {
    const seedRng = rng.fork(`seed:${region.id}`);
    vegetation.set(region.id, 0.5 + seedRng.range(-0.1, 0.15));
    fireFertilizationTicksLeft.set(region.id, 0);

    const regionStocks = new Map<SpeciesId, number>();
    for (const species of SPECIES) {
      const cap = capacityFor(species, region.biome, 0.6);
      const inBiome = species.biomeAffinity.includes(region.biome);
      const startFraction = inBiome ? seedRng.range(0.4, 0.7) : seedRng.range(0, 0.05);
      regionStocks.set(species.id, cap * startFraction);
    }
    stocks.set(region.id, regionStocks);
  }

  const state: SimState = {
    tick: 0 as Tick,
    regions,
    stocks,
    vegetation,
    fireFertilizationTicksLeft,
    activeRateModifiers: new Map(),
    pressureLedger: createPressureLedger(),
    ruleRuntime: createRuleRuntimeState(),
    migrationQueue: [],
    cascadeLog: [],
    recentFiredByRegion: new Map(),
    weather: 'clear',
    extinctSpecies: new Set(),
    recentDeathRate: new Map(),
    stockHistory: new Map(),
  };
  for (const [regionId, regionStocks] of stocks) {
    for (const [speciesId, stock] of regionStocks) state.stockHistory.set(`${speciesId}|${regionId}`, stock);
  }
  return state;
}

export function createHeadlessState(rng: Rng): SimState {
  return createInitialState(syntheticRegions(), rng);
}

export function normalizedStock(state: SimState, species: SpeciesDef, regionId: RegionId): number {
  const region = state.regions.find((r) => r.id === regionId);
  if (region === undefined) return 0;
  const veg = state.vegetation.get(regionId) ?? 0.5;
  const cap = capacityFor(species, region.biome, veg);
  const stock = state.stocks.get(regionId)?.get(species.id) ?? 0;
  return cap <= 0 ? 0 : stock / cap;
}

export function computeStateHash(state: SimState): string {
  return hashState(state);
}

// -------------------------------------------------------------------------------------------
// Save / load — plain-JSON-safe snapshot. Maps/Sets don't survive JSON.stringify on their own,
// so every Map/Set field is converted to a sorted array of entries and back.
// -------------------------------------------------------------------------------------------

export interface SimStateSnapshot {
  tick: number;
  regions: RegionNode[];
  stocks: [string, [string, number][]][];
  vegetation: [string, number][];
  fireFertilizationTicksLeft: [string, number][];
  activeRateModifiers: [string, ActiveRateModifier[]][];
  pressureLedger: Record<string, PressureCell>;
  ruleRuntime: [string, RuleRuntimeCell][];
  migrationQueue: MigrationTask[];
  cascadeLog: CascadeLogEntry[];
  recentFiredByRegion: [string, { ruleId: string; tick: Tick }[]][];
  weather: WeatherKind;
  extinctSpecies: string[];
  recentDeathRate: [string, number][];
  stockHistory: [string, number][];
}

export function toSnapshot(state: SimState): SimStateSnapshot {
  return {
    tick: state.tick,
    regions: state.regions,
    stocks: [...state.stocks.entries()].map(([r, m]) => [r, [...m.entries()]] as [string, [string, number][]]),
    vegetation: [...state.vegetation.entries()],
    fireFertilizationTicksLeft: [...state.fireFertilizationTicksLeft.entries()],
    activeRateModifiers: [...state.activeRateModifiers.entries()],
    pressureLedger: serializeLedger(state.pressureLedger),
    ruleRuntime: [...state.ruleRuntime.entries()],
    migrationQueue: [...state.migrationQueue],
    cascadeLog: [...state.cascadeLog],
    recentFiredByRegion: [...state.recentFiredByRegion.entries()],
    weather: state.weather,
    extinctSpecies: [...state.extinctSpecies],
    recentDeathRate: [...state.recentDeathRate.entries()],
    stockHistory: [...state.stockHistory.entries()],
  };
}

export function fromSnapshot(snapshot: SimStateSnapshot): SimState {
  return {
    tick: snapshot.tick as Tick,
    regions: snapshot.regions,
    stocks: new Map(snapshot.stocks.map(([r, m]) => [r as RegionId, new Map(m as [SpeciesId, number][])])),
    vegetation: new Map(snapshot.vegetation as [RegionId, number][]),
    fireFertilizationTicksLeft: new Map(snapshot.fireFertilizationTicksLeft as [RegionId, number][]),
    activeRateModifiers: new Map(snapshot.activeRateModifiers),
    pressureLedger: deserializeLedger(snapshot.pressureLedger),
    ruleRuntime: new Map(snapshot.ruleRuntime),
    migrationQueue: [...snapshot.migrationQueue],
    cascadeLog: [...snapshot.cascadeLog],
    recentFiredByRegion: new Map(snapshot.recentFiredByRegion as [RegionId, { ruleId: string; tick: Tick }[]][]),
    weather: snapshot.weather,
    extinctSpecies: new Set(snapshot.extinctSpecies),
    recentDeathRate: new Map(snapshot.recentDeathRate as [RegionId, number][]),
    stockHistory: new Map(snapshot.stockHistory),
  };
}

export function serializeState(state: SimState): string {
  return JSON.stringify(toSnapshot(state));
}

export function deserializeState(json: string): SimState {
  return fromSnapshot(JSON.parse(json) as SimStateSnapshot);
}
