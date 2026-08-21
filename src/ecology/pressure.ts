/**
 * The player pressure ledger — the actual "memory" the game's premise depends on. Persistent,
 * per-species per-region kill counts. Only `cause: 'player'` deaths are recorded (card point 4;
 * see also INTEGRATION_NOTES.md — this is the one distinction the whole game rests on).
 *
 * Decay is read-time: we store the raw historical count and the tick of the most recent kill,
 * and compute an exponentially-decayed "how much does this still matter right now" value on
 * demand. That keeps the ledger trivial to save/load exactly (plain numbers, no background
 * ticking state to drift) while still giving `pressure` the "fades over time" behaviour the
 * card asks for. `totalKills` itself is never decayed — it's the true historical count.
 */

import type { RegionId, SpeciesId, Tick } from '@contracts/index';
import type { PressureRecord } from '@contracts/index';
import { PRESSURE_HALF_LIFE_TICKS, PRESSURE_SATURATION_FRACTION } from './pressure.data';

export interface PressureCell {
  count: number;
  lastKillTick: Tick;
}

/** Serializable: `${speciesId}|${regionId}` -> cell. Exactly what save/load persists. */
export type PressureLedger = Map<string, PressureCell>;

export function createPressureLedger(): PressureLedger {
  return new Map();
}

const key = (speciesId: SpeciesId, regionId: RegionId): string => `${speciesId}|${regionId}`;

export function recordPlayerKill(ledger: PressureLedger, speciesId: SpeciesId, regionId: RegionId, tick: Tick): void {
  const k = key(speciesId, regionId);
  const existing = ledger.get(k);
  ledger.set(k, { count: (existing?.count ?? 0) + 1, lastKillTick: tick });
}

/** Exponential decay of one cell's contribution, evaluated at `tick`. Never mutates the cell. */
export function decayedWeight(cell: PressureCell, tick: Tick): number {
  const elapsed = Math.max(0, tick - cell.lastKillTick);
  const halfLives = elapsed / PRESSURE_HALF_LIFE_TICKS;
  return cell.count * Math.pow(0.5, halfLives);
}

export function pressureRecordFor(
  ledger: PressureLedger,
  speciesId: SpeciesId,
  regionCapacity: number,
  tick: Tick,
): PressureRecord {
  let totalKills = 0;
  let decayedTotal = 0;
  let lastKillTick: Tick = 0;
  const killsByRegion: Record<string, number> = {};

  for (const [k, cell] of ledger) {
    const [sid, rid] = k.split('|');
    if (sid !== speciesId || rid === undefined) continue;
    totalKills += cell.count;
    decayedTotal += decayedWeight(cell, tick);
    killsByRegion[rid] = (killsByRegion[rid] ?? 0) + cell.count;
    if (cell.lastKillTick > lastKillTick) lastKillTick = cell.lastKillTick;
  }

  const saturation = Math.max(4, regionCapacity * PRESSURE_SATURATION_FRACTION);
  return {
    speciesId,
    totalKills,
    killsByRegion,
    pressure: Math.max(0, Math.min(1, decayedTotal / saturation)),
    lastKillTick,
  };
}

/** Decayed pressure restricted to one region — what nature rules actually condition on. */
export function regionalDecayedPressure(ledger: PressureLedger, speciesId: SpeciesId, regionId: RegionId, tick: Tick): number {
  const cell = ledger.get(key(speciesId, regionId));
  return cell === undefined ? 0 : decayedWeight(cell, tick);
}

export function serializeLedger(ledger: PressureLedger): Record<string, PressureCell> {
  return Object.fromEntries(ledger);
}

export function deserializeLedger(data: Record<string, PressureCell>): PressureLedger {
  return new Map(Object.entries(data));
}
