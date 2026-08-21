/**
 * Ties population, vegetation, the rules engine, and migration together into one deterministic
 * tick. `advanceOneTick` is the only function that mutates a `SimState` — everything upstream
 * (population.ts, vegetation.ts, rulesEngine.ts, migration.ts) stays pure and independently
 * testable. Deliberately has no EventBus dependency: it returns a plain `TickResult` describing
 * what happened, and callers (index.ts for the live game, tests for headless runs) decide what,
 * if anything, to emit. That's what makes `simulateEcology` a true headless function.
 */

import { createRng, type RegionId, type SpeciesId, type Tick } from '@contracts/index';
import { SPECIES, speciesDef } from './species.data';
import type { RegionNode } from './regions';
import { syntheticRegions } from './regions';
import type { SimState } from './state';
import { createInitialState, normalizedStock } from './state';
import { modifiersAt } from './seasons';
import { capacityFor, isLocallyExtinct, stepRegionPopulations } from './population';
import { stepVegetation } from './vegetation';
import { DEFAULT_WATER_AVAILABILITY } from './vegetation.data';
import { ALL_RULES } from './natureRules.data';
import { stepRulesForRegion, type FiredCascade } from './rulesEngine';
import { buildRegionFacts, activeRateMultipliers, addRateModifier, producerHealth, grazingPressure } from './facts';
import { diffuseRegions, popDueMigrations, scheduleMigration, bestSourceNeighbor, type MigrationTask } from './migration';
import { recordPlayerKill, regionalDecayedPressure } from './pressure';
import type { Effect } from './rules.types';

export interface MigrationResult {
  speciesId: SpeciesId;
  fromRegion: RegionId | null;
  toRegion: RegionId;
  count: number;
  reason: MigrationTask['reason'];
}

export interface ExtinctionResult {
  speciesId: SpeciesId;
  regionId: RegionId | null;
  playerCaused: boolean;
}

export interface PopulationDelta {
  speciesId: SpeciesId;
  regionId: RegionId;
  count: number;
  delta: number;
  normalized: number;
}

export interface VegetationDelta {
  regionId: RegionId;
  density: number;
  delta: number;
}

export interface TickResult {
  tick: Tick;
  cascades: FiredCascade[];
  migrations: MigrationResult[];
  extinctions: ExtinctionResult[];
  populationDeltas: PopulationDelta[];
  vegetationDeltas: VegetationDelta[];
}

function applyEffect(state: SimState, effect: Effect, regionId: RegionId, tick: Tick, fireRegions: Set<RegionId>): void {
  switch (effect.kind) {
    case 'populationRate':
      addRateModifier(state.activeRateModifiers, effect.species, regionId, effect.multiplier, tick + effect.durationTicks);
      return;
    case 'vegetationDelta': {
      const cur = state.vegetation.get(regionId) ?? 0.5;
      state.vegetation.set(regionId, Math.max(0, Math.min(1, cur + effect.delta)));
      return;
    }
    case 'fire':
      fireRegions.add(regionId);
      return;
    case 'migration': {
      if (effect.direction === 'out') {
        const stocks = state.stocks.get(regionId);
        const cur = stocks?.get(effect.species) ?? 0;
        stocks?.set(effect.species, Math.max(0, cur * (1 - effect.countFraction)));
        return;
      }
      const source = effect.fromAdjacent === true ? findRegionForMigrationSource(state, regionId, effect.species) : null;
      scheduleMigration(state.migrationQueue, effect.species, regionId, source, effect.countFraction, effect.reason, tick);
      return;
    }
    case 'populationShock': {
      const stocks = state.stocks.get(regionId);
      const cur = stocks?.get(effect.species) ?? 0;
      stocks?.set(effect.species, Math.max(0, cur * (1 + effect.fractionDelta)));
      return;
    }
  }
}

function findRegionForMigrationSource(state: SimState, toRegion: RegionId, speciesId: SpeciesId): RegionId | null {
  const region = state.regions.find((r) => r.id === toRegion);
  if (region === undefined) return null;
  return bestSourceNeighbor(speciesId, region, state.stocks);
}

/** Mutates `state` forward by exactly one tick and reports everything that happened. */
export function advanceOneTick(state: SimState): TickResult {
  const tick = (state.tick + 1) as Tick;
  const fireRegionsThisTick = new Set<RegionId>();
  const cascades: FiredCascade[] = [];

  // 1. Rules see the world as of the end of the previous tick, then their effects land now.
  for (const region of state.regions) {
    const stocks = state.stocks.get(region.id) ?? new Map<SpeciesId, number>();
    const veg = state.vegetation.get(region.id) ?? 0.5;
    const facts = buildRegionFacts(region, stocks, veg, state.pressureLedger, state.tick, state.weather);
    const recentIds = (state.recentFiredByRegion.get(region.id) ?? []).map((e) => e.ruleId);
    const fired = stepRulesForRegion(ALL_RULES, state.ruleRuntime, facts, tick, recentIds);
    for (const f of fired) {
      cascades.push(f);
      for (const effect of f.effects) applyEffect(state, effect, region.id, tick, fireRegionsThisTick);
    }
  }

  // 2. Resolve migrations scheduled on a previous tick.
  const migrations: MigrationResult[] = [];
  for (const task of popDueMigrations(state.migrationQueue, tick)) {
    const region = state.regions.find((r) => r.id === task.toRegion);
    if (region === undefined) continue;
    const species = speciesDef(task.speciesId);
    const veg = state.vegetation.get(task.toRegion) ?? 0.5;
    const cap = capacityFor(species, region.biome, veg);
    const count = Math.max(1, Math.round(cap * task.countFraction));

    const destStocks = state.stocks.get(task.toRegion) ?? new Map<SpeciesId, number>();
    destStocks.set(task.speciesId, (destStocks.get(task.speciesId) ?? 0) + count);
    state.stocks.set(task.toRegion, destStocks);

    if (task.fromRegion !== null) {
      const srcStocks = state.stocks.get(task.fromRegion);
      if (srcStocks !== undefined) {
        srcStocks.set(task.speciesId, Math.max(0, (srcStocks.get(task.speciesId) ?? 0) - count));
      }
    }
    migrations.push({ speciesId: task.speciesId, fromRegion: task.fromRegion, toRegion: task.toRegion, count, reason: task.reason });
  }

  // 3. Population step, per region.
  const newStocks = new Map<RegionId, Map<SpeciesId, number>>();
  const mortalityByRegion = new Map<RegionId, number>();
  const season = modifiersAt(tick);
  for (const region of state.regions) {
    const stocks = state.stocks.get(region.id) ?? new Map<SpeciesId, number>();
    const veg = state.vegetation.get(region.id) ?? 0.5;
    const rateMultipliers = activeRateMultipliers(state.activeRateModifiers, region.id, tick);
    const deathRate = state.recentDeathRate.get(region.id) ?? 0;
    const result = stepRegionPopulations({ biome: region.biome, vegetationDensity: veg, season, stocks, recentDeathRate: deathRate, rateMultipliers });
    newStocks.set(region.id, result.stocks);
    mortalityByRegion.set(region.id, result.mortality);
  }

  // 4. Vegetation step, per region — reads the stocks population just produced.
  const newVeg = new Map<RegionId, number>();
  const newFireTicks = new Map<RegionId, number>();
  for (const region of state.regions) {
    const stocksAfter = newStocks.get(region.id)!;
    const veg = state.vegetation.get(region.id) ?? 0.5;
    const result = stepVegetation({
      biome: region.biome,
      current: veg,
      producerHealth: producerHealth(region, stocksAfter, veg),
      grazingPressure: grazingPressure(region, stocksAfter, veg),
      waterAvailability: DEFAULT_WATER_AVAILABILITY[region.biome],
      season,
      fireNow: fireRegionsThisTick.has(region.id),
      fireFertilizationTicksLeft: state.fireFertilizationTicksLeft.get(region.id) ?? 0,
    });
    newVeg.set(region.id, result.density);
    newFireTicks.set(region.id, result.fireFertilizationTicksLeft);
  }

  // 5. Region coupling: a small diffusion pass on top of the settled within-region dynamics.
  const diffused = diffuseRegions(newStocks, state.regions, newVeg);

  // 6. Commit + derive deltas for the caller.
  const populationDeltas: PopulationDelta[] = [];
  const extinctions: ExtinctionResult[] = [];
  for (const region of state.regions) {
    const before = state.stocks.get(region.id) ?? new Map<SpeciesId, number>();
    const after = diffused.get(region.id)!;
    for (const species of SPECIES) {
      const prevStock = before.get(species.id) ?? 0;
      const stock = after.get(species.id) ?? 0;
      const cap = capacityFor(species, region.biome, newVeg.get(region.id) ?? 0.5);
      populationDeltas.push({
        speciesId: species.id,
        regionId: region.id,
        count: Math.round(stock),
        delta: stock - prevStock,
        normalized: cap <= 0 ? 0 : stock / cap,
      });

      const extinctKey = `${species.id}|${region.id}`;
      const nowExtinct = isLocallyExtinct(species, region.biome, newVeg.get(region.id) ?? 0.5, stock);
      const wasExtinct = state.extinctSpecies.has(extinctKey);
      if (nowExtinct && !wasExtinct) {
        state.extinctSpecies.add(extinctKey);
        extinctions.push({
          speciesId: species.id,
          regionId: region.id,
          playerCaused: regionalDecayedPressure(state.pressureLedger, species.id, region.id, tick) > 0.5,
        });
      } else if (!nowExtinct && wasExtinct) {
        state.extinctSpecies.delete(extinctKey);
      }
    }
  }

  const vegetationDeltas: VegetationDelta[] = state.regions.map((region) => ({
    regionId: region.id,
    density: newVeg.get(region.id) ?? 0.5,
    delta: (newVeg.get(region.id) ?? 0.5) - (state.vegetation.get(region.id) ?? 0.5),
  }));

  state.stocks = diffused;
  state.vegetation = newVeg;
  state.fireFertilizationTicksLeft = newFireTicks;
  state.tick = tick;

  for (const region of state.regions) {
    const prev = state.recentDeathRate.get(region.id) ?? 0;
    const flux = mortalityByRegion.get(region.id) ?? 0;
    state.recentDeathRate.set(region.id, prev * 0.995 + flux * 0.02);
  }

  if (tick % 1000 === 0) {
    for (const region of state.regions) {
      const regionStocks = state.stocks.get(region.id);
      if (regionStocks === undefined) continue;
      for (const [speciesId, stock] of regionStocks) state.stockHistory.set(`${speciesId}|${region.id}`, stock);
    }
  }

  const window = 6_000;
  for (const f of cascades) {
    state.cascadeLog.push({ tick, ruleId: f.ruleId, regionId: f.regionId, chain: f.chain, narrative: f.narrative, severity: f.severity, blamedSpecies: f.blamedSpecies });
    if (state.cascadeLog.length > 500) state.cascadeLog.shift();
    const list = state.recentFiredByRegion.get(f.regionId) ?? [];
    list.push({ ruleId: f.ruleId, tick });
    state.recentFiredByRegion.set(f.regionId, list.filter((e) => tick - e.tick <= window));
  }

  return { tick, cascades, migrations, extinctions, populationDeltas, vegetationDeltas };
}

export function advanceToTick(state: SimState, targetTick: Tick, onTick?: (result: TickResult) => void): void {
  while (state.tick < targetTick) {
    const result = advanceOneTick(state);
    onTick?.(result);
  }
}

/** The one place a player kill is registered against the model — ledger + immediate stock loss. */
export function applyKillToState(state: SimState, speciesId: SpeciesId, regionId: RegionId, isPlayerCause: boolean): void {
  const stocks = state.stocks.get(regionId);
  if (stocks !== undefined) {
    stocks.set(speciesId, Math.max(0, (stocks.get(speciesId) ?? 0) - 1));
  }
  if (isPlayerCause) {
    recordPlayerKill(state.pressureLedger, speciesId, regionId, state.tick);
    const prev = state.recentDeathRate.get(regionId) ?? 0;
    state.recentDeathRate.set(regionId, prev + 0.6);
  }
}

// -------------------------------------------------------------------------------------------
// Headless entry point — cascades tested in Vitest with no browser, no ctx, no bus.
// -------------------------------------------------------------------------------------------

export interface ScriptedKill {
  tick: Tick;
  speciesId: SpeciesId;
  regionId: RegionId;
}

export interface HeadlessResult {
  finalTick: Tick;
  regions: readonly RegionNode[];
  populations: PopulationDelta[];
  vegetation: Record<string, number>;
  cascades: { ruleId: string; tick: Tick; regionId: RegionId; chain: string[]; narrative: string }[];
  state: SimState;
}

/**
 * Runs the simulation with no browser, no service registry, and no event bus — the main tuning
 * and testing tool. Uses the 9-region synthetic map (see regions.ts) so 100k ticks stays well
 * under a second: no allocation-heavy per-tick work beyond the Maps population.ts already needs.
 */
export function simulateEcology(
  seed: number,
  ticks: number,
  scriptedKills: readonly ScriptedKill[] = [],
  regions: readonly RegionNode[] = syntheticRegions(),
): HeadlessResult {
  const rng = createRng(seed).fork('ecology-headless');
  const state = createInitialState([...regions], rng);
  const killsByTick = new Map<Tick, ScriptedKill[]>();
  for (const kill of scriptedKills) {
    const list = killsByTick.get(kill.tick) ?? [];
    list.push(kill);
    killsByTick.set(kill.tick, list);
  }

  const allCascades: HeadlessResult['cascades'] = [];
  let lastPopulationDeltas: PopulationDelta[] = [];

  for (let t = 1; t <= ticks; t++) {
    for (const kill of killsByTick.get(t as Tick) ?? []) {
      applyKillToState(state, kill.speciesId, kill.regionId, true);
    }
    const result = advanceOneTick(state);
    lastPopulationDeltas = result.populationDeltas;
    for (const c of result.cascades) {
      allCascades.push({ ruleId: c.ruleId, tick: result.tick, regionId: c.regionId, chain: c.chain, narrative: c.narrative });
    }
  }

  const vegetation: Record<string, number> = {};
  for (const [regionId, density] of state.vegetation) vegetation[regionId] = density;

  return {
    finalTick: state.tick,
    regions: state.regions,
    populations: lastPopulationDeltas,
    vegetation,
    cascades: allCascades,
    state,
  };
}

export { syntheticRegions, normalizedStock };
