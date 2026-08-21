import { describe, expect, it } from 'vitest';
import { regionId, speciesId, type Tick } from '@contracts/index';
import {
  createPressureLedger,
  decayedWeight,
  deserializeLedger,
  pressureRecordFor,
  recordPlayerKill,
  regionalDecayedPressure,
  serializeLedger,
} from '../../src/ecology/pressure';
import { PRESSURE_HALF_LIFE_TICKS } from '../../src/ecology/pressure.data';

const WOLF = speciesId('grey_wolf');
const REGION_A = regionId('region_a');
const REGION_B = regionId('region_b');

describe('player pressure ledger', () => {
  it('records a kill and total kills reflect the raw historical count, never decayed', () => {
    const ledger = createPressureLedger();
    recordPlayerKill(ledger, WOLF, REGION_A, 0 as Tick);
    recordPlayerKill(ledger, WOLF, REGION_A, 100 as Tick);
    const record = pressureRecordFor(ledger, WOLF, 20, 100_000 as Tick);
    expect(record.totalKills).toBe(2);
  });

  it('decays to roughly half its weight after exactly one half-life', () => {
    const ledger = createPressureLedger();
    recordPlayerKill(ledger, WOLF, REGION_A, 0 as Tick);
    const cell = ledger.get(`${WOLF}|${REGION_A}`)!;
    const halved = decayedWeight(cell, PRESSURE_HALF_LIFE_TICKS as Tick);
    expect(halved).toBeCloseTo(0.5, 5);
  });

  it('distinguishes kills by region in killsByRegion', () => {
    const ledger = createPressureLedger();
    recordPlayerKill(ledger, WOLF, REGION_A, 0 as Tick);
    recordPlayerKill(ledger, WOLF, REGION_A, 0 as Tick);
    recordPlayerKill(ledger, WOLF, REGION_B, 0 as Tick);
    const record = pressureRecordFor(ledger, WOLF, 20, 0 as Tick);
    expect(record.killsByRegion[REGION_A]).toBe(2);
    expect(record.killsByRegion[REGION_B]).toBe(1);
  });

  it('regionalDecayedPressure is 0 for a species/region with no kills', () => {
    const ledger = createPressureLedger();
    expect(regionalDecayedPressure(ledger, WOLF, REGION_A, 0 as Tick)).toBe(0);
  });

  it('round-trips through serialize/deserialize exactly', () => {
    const ledger = createPressureLedger();
    recordPlayerKill(ledger, WOLF, REGION_A, 42 as Tick);
    recordPlayerKill(ledger, WOLF, REGION_B, 99 as Tick);
    const restored = deserializeLedger(JSON.parse(JSON.stringify(serializeLedger(ledger))));
    expect(pressureRecordFor(restored, WOLF, 20, 200 as Tick)).toEqual(pressureRecordFor(ledger, WOLF, 20, 200 as Tick));
  });
});
