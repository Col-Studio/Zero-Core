/**
 * `ecology`'s public API. Two exports matter to the rest of the project:
 *
 *   • `mountEcology(ctx)` — the standard `MountFn` every module exports. Builds the live
 *     simulation, wires the event-bus listeners (`creature:died`, `weather:changed`), and keeps
 *     the model advancing lazily (caught up to `ctx.getTick()` the moment anything asks a
 *     question of it — see `ensureCaughtUp` below). Returns a disposer.
 *   • `simulateEcology(seed, ticks, scriptedKills)` — the headless entry point for Vitest, with
 *     no ctx, no bus, no browser.
 *
 * ## Wiring note for the integration lead (also in INTEGRATION_NOTES.md)
 *
 * `ctx.services` is intentionally read-only (`ServiceRegistryLike`), so `mountEcology` cannot
 * call `registry.register('ecology', ...)` itself — only `App.tsx` holds the real
 * `ServiceRegistry`. Call `mountEcology(ctx)` once, then:
 *
 *   const ecology = getMountedEcologyService();
 *   if (ecology) registry.register('ecology', ecology);
 *
 * before (or right after) mounting the modules that depend on `ecology` query results.
 */

import type {
  DeathCause,
  IEcologyQuery,
  MountContext,
  RegionId,
  SpeciesId,
  Tick,
  WeatherKind,
} from '@contracts/index';
import { regionsFromWorld, syntheticRegions } from './regions';
import { createInitialState, type SimState } from './state';
import { advanceOneTick, applyKillToState, type TickResult } from './sim';
import { buildEcologyQuery } from './query';

export { simulateEcology } from './sim';
export type { ScriptedKill, HeadlessResult } from './sim';
export { SPECIES, SPECIES_BY_ID, speciesDef, KEYSTONE_SPECIES } from './species.data';
export { ALL_RULES, RULES_BY_ID } from './natureRules.data';
export type { NatureRule, Condition, Effect } from './rules.types';
export { computeStateHash, serializeState, deserializeState } from './state';
export type { SimStateSnapshot } from './state';

const VEG_EMIT_INTERVAL_TICKS = 4; // ~5 Hz — "a few times per second per region" (card point 5)
const POP_EMIT_INTERVAL_TICKS = 20; // 1 Hz per species/region is plenty for UI purposes

interface RunningEngine {
  state: SimState;
  query: IEcologyQuery;
  ensureCaughtUp(): void;
}

let mounted: RunningEngine | null = null;

/** For the integration lead's `registry.register('ecology', ...)` call — see header note. */
export function getMountedEcologyService(): IEcologyQuery | null {
  return mounted?.query ?? null;
}

/** For dev/Harness.tsx and dev/Dashboard.tsx — read-only access to the live state for graphs. */
export function getMountedEcologyState(): SimState | null {
  return mounted?.state ?? null;
}

export function mountEcology(ctx: MountContext): () => void {
  const rng = ctx.rng.fork('ecology');

  // Read the region roster through the accessor exactly once, at mount — not cached as a live
  // service reference, just its (effectively static) data. Falls back to the synthetic map
  // while `world` is still a Null, matching CLAUDE.md's "develop against Nulls with confidence".
  let regions;
  try {
    const fromWorld = regionsFromWorld(ctx.services.world());
    regions = fromWorld.length > 0 ? fromWorld : syntheticRegions();
  } catch {
    regions = syntheticRegions();
  }

  const state = createInitialState(regions, rng.fork('sim'));

  const lastVegEmit = new Map<RegionId, { tick: Tick; density: number }>();
  const lastPopEmit = new Map<string, { tick: Tick; count: number }>();

  function emitTickResult(result: TickResult): void {
    for (const c of result.cascades) {
      ctx.bus.emit({ type: 'cascade:triggered', ruleId: c.ruleId, regionId: c.regionId, chain: c.chain, narrative: c.narrative, severity: c.severity, blamedSpecies: c.blamedSpecies });
    }
    for (const m of result.migrations) {
      ctx.bus.emit({ type: 'species:migrating', speciesId: m.speciesId, fromRegion: m.fromRegion, toRegion: m.toRegion, count: m.count, reason: m.reason });
    }
    for (const e of result.extinctions) {
      ctx.bus.emit({ type: 'species:extinct', speciesId: e.speciesId, regionId: e.regionId, playerCaused: e.playerCaused });
    }
    for (const v of result.vegetationDeltas) {
      const last = lastVegEmit.get(v.regionId);
      if (last === undefined || result.tick - last.tick >= VEG_EMIT_INTERVAL_TICKS) {
        const delta = v.density - (last?.density ?? v.density);
        ctx.bus.emit({ type: 'vegetation:changed', regionId: v.regionId, density: v.density, delta });
        lastVegEmit.set(v.regionId, { tick: result.tick, density: v.density });
      }
    }
    for (const p of result.populationDeltas) {
      const key = `${p.speciesId}|${p.regionId}`;
      const last = lastPopEmit.get(key);
      const dueByTime = last === undefined || result.tick - last.tick >= POP_EMIT_INTERVAL_TICKS;
      if (dueByTime && p.count !== (last?.count ?? -1)) {
        const delta = p.count - (last?.count ?? p.count);
        ctx.bus.emit({ type: 'population:changed', speciesId: p.speciesId, regionId: p.regionId, count: p.count, delta, normalized: p.normalized });
        lastPopEmit.set(key, { tick: result.tick, count: p.count });
      }
    }
  }

  function ensureCaughtUp(): void {
    const target = ctx.getTick();
    while (state.tick < target) {
      emitTickResult(advanceOneTick(state));
    }
  }

  const query = buildEcologyQuery({
    getState: () => {
      ensureCaughtUp();
      return state;
    },
    onApplyKill: (speciesId: SpeciesId, regionId: RegionId, cause: DeathCause) => {
      ensureCaughtUp();
      applyKillToState(state, speciesId, regionId, cause === 'player');
    },
  });

  const offKill = ctx.bus.on(
    'creature:died',
    (e) => {
      ensureCaughtUp();
      applyKillToState(state, e.speciesId, e.regionId, e.cause === 'player');
    },
    'ecology:creatureDied',
  );

  // `world` is the real owner of weather; ecology just needs "is it stormy right now" for the
  // fire-ecology rule. Single global value is a deliberate simplification — see
  // INTEGRATION_NOTES.md for the alignment note if per-region weather turns out to matter.
  const offWeather = ctx.bus.on(
    'weather:changed',
    (e: { kind: WeatherKind }) => {
      state.weather = e.kind;
    },
    'ecology:weatherChanged',
  );

  mounted = { state, query, ensureCaughtUp };

  return () => {
    offKill();
    offWeather();
    if (mounted?.state === state) mounted = null;
  };
}
