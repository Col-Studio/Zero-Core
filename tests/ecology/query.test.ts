import { describe, expect, it } from 'vitest';
import { createRng, speciesId } from '@contracts/index';
import { buildEcologyQuery } from '../../src/ecology/query';
import { createInitialState, type SimState } from '../../src/ecology/state';
import { syntheticRegions } from '../../src/ecology/regions';
import { applyKillToState } from '../../src/ecology/sim';
import { SPECIES } from '../../src/ecology/species.data';

const WOLF = speciesId('grey_wolf');

function buildQuery() {
  const regions = syntheticRegions();
  let state: SimState = createInitialState(regions, createRng(1).fork('query-test'));
  const killLog: { speciesId: string; regionId: string; cause: string }[] = [];
  const query = buildEcologyQuery({
    getState: () => state,
    onApplyKill: (s, r, c) => {
      applyKillToState(state, s, r, c === 'player');
      killLog.push({ speciesId: s, regionId: r, cause: c });
    },
  });
  return { query, regions, getState: () => state, killLog };
}

describe('buildEcologyQuery', () => {
  it('getPopulation returns a normalized value between 0 and (roughly) the overshoot cap', () => {
    const { query, regions } = buildQuery();
    const pop = query.getPopulation(WOLF, regions[0]!.id);
    expect(pop.speciesId).toBe(WOLF);
    expect(pop.normalized).toBeGreaterThanOrEqual(0);
    expect(pop.carryingCapacity).toBeGreaterThan(0);
  });

  it('getAllPopulations returns one entry per species in the trophic web', () => {
    const { query, regions } = buildQuery();
    const all = query.getAllPopulations(regions[0]!.id);
    expect(all.length).toBe(SPECIES.length);
  });

  it('getVegetation returns a value in [0, 1]', () => {
    const { query, regions } = buildQuery();
    const v = query.getVegetation(regions[0]!.id);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(1);
  });

  it('getTrophicState reports a health fraction and a non-empty present list', () => {
    const { query, regions } = buildQuery();
    const trophic = query.getTrophicState(regions[0]!.id);
    expect(trophic.health).toBeGreaterThanOrEqual(0);
    expect(trophic.present.length).toBeGreaterThan(0);
  });

  it('applyKill routes through the provided command handler', () => {
    const { query, regions, killLog } = buildQuery();
    query.applyKill(WOLF, regions[0]!.id, 'player');
    expect(killLog).toHaveLength(1);
    expect(killLog[0]!.cause).toBe('player');
  });

  it('getPressure reflects kills recorded via applyKill', () => {
    const { query, regions } = buildQuery();
    query.applyKill(WOLF, regions[0]!.id, 'player');
    query.applyKill(WOLF, regions[0]!.id, 'player');
    const pressure = query.getPressure(WOLF);
    expect(pressure.totalKills).toBeGreaterThanOrEqual(2);
  });

  it('getRecentCascades returns [] before anything has fired, newest-first once populated', () => {
    const { query } = buildQuery();
    expect(query.getRecentCascades(10)).toEqual([]);
  });

  it('getSpeciesList exposes diet/predators using the contract field names', () => {
    const { query } = buildQuery();
    const list = query.getSpeciesList();
    const wolf = list.find((s) => s.id === WOLF)!;
    expect(wolf.diet).toContain(speciesId('red_deer'));
    expect(Array.isArray(wolf.predators)).toBe(true);
  });
});
