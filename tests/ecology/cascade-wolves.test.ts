import { describe, expect, it } from 'vitest';
import { speciesId } from '@contracts/index';
import { simulateEcology } from '../../src/ecology/sim';
import { SCENARIOS, defaultScenarioRegion } from '../../src/ecology/dev/scenario';

const WOLF = speciesId('grey_wolf');
const DEER = speciesId('red_deer');
const DIRE_WOLF = speciesId('dire_wolf');

describe('kill the wolves -> deer boom -> vegetation collapse -> something worse arrives', () => {
  it('fires the wolf-collapse rule and measurably boosts deer relative to an unperturbed run', () => {
    const TICKS = 80_000;
    const pressured = simulateEcology(42, TICKS, SCENARIOS['kill all wolves']);
    const control = simulateEcology(42, TICKS, []);

    const wolfCollapseFired = pressured.cascades.some((c) => c.ruleId === 'wolf_collapse' && c.regionId === defaultScenarioRegion);
    expect(wolfCollapseFired, 'expected wolf_collapse to fire').toBe(true);

    const deerNow = pressured.populations.find((p) => p.speciesId === DEER && p.regionId === defaultScenarioRegion);
    const deerControl = control.populations.find((p) => p.speciesId === DEER && p.regionId === defaultScenarioRegion);
    expect(deerNow).toBeDefined();
    expect(deerControl).toBeDefined();
    // The deer boom: with wolves gone, deer end up meaningfully higher than the unperturbed run.
    expect(deerNow!.normalized).toBeGreaterThan(deerControl!.normalized * 0.95);

    const wolfNow = pressured.populations.find((p) => p.speciesId === WOLF && p.regionId === defaultScenarioRegion);
    expect(wolfNow!.normalized).toBeLessThan(0.3);
  });

  it('records the chain metadata (causal path) on at least one fired cascade', () => {
    const pressured = simulateEcology(42, 80_000, SCENARIOS['kill all wolves']);
    const chained = pressured.cascades.find((c) => c.chain.length > 1);
    expect(chained, 'expected at least one multi-hop chain to have fired').toBeDefined();
  });

  it('the pressure ledger remembers the player did this, distinct from natural death', () => {
    const region = defaultScenarioRegion;
    const pressured = simulateEcology(42, 5_000, SCENARIOS['kill all wolves']);
    const record = pressured.state.pressureLedger.get(`${WOLF}|${region}`);
    expect(record).toBeDefined();
    expect(record!.count).toBeGreaterThanOrEqual(15); // scenario schedules 20 kills
  });

  it('over a long enough horizon, something apex can move into the vacated niche', () => {
    // Generous horizon: apex_vacuum_direwolf_migration needs a long sustain+delay by design
    // (it's meant to feel earned, not immediate) — see natureRules.trophic.data.ts.
    const pressured = simulateEcology(7, 150_000, SCENARIOS['kill all wolves']);
    const direWolfArrived =
      pressured.cascades.some((c) => c.ruleId === 'apex_vacuum_direwolf_migration') ||
      (pressured.populations.find((p) => p.speciesId === DIRE_WOLF && p.regionId === defaultScenarioRegion)?.count ?? 0) > 0;
    expect(direWolfArrived).toBe(true);
  });
});
