/**
 * The save format, versioned from day one.
 *
 * "The world remembers what you did to it" is the pitch, so the save file is not an afterthought:
 * it is the thing the pitch is made of. Two rules keep it honest.
 *
 *   1. **Versioned, with migrations.** A save written by today's build must still open in three
 *      weeks. `migrate()` walks a save up one version at a time; there is no "just reset your
 *      save" escape hatch, because six other members will have hours of world state by then.
 *   2. **Plain JSON only.** No class instances, no `Map`, no typed arrays. Everything here is
 *      what `hashState()` can hash and `structuredClone` can copy, which is what makes
 *      save → load → hash-equal a testable property instead of a hope.
 */

import type { Tick } from '@contracts/ids';
import type { EcsSnapshot } from '@core/ecs/world';
import { SAVE } from '../core.data';

/** One recorded event, enough to replay it. */
export interface RecordedEvent {
  tick: Tick;
  seq: number;
  event: Record<string, unknown> & { type: string };
}

export interface SaveEnvelope {
  /** Format version. Compare against `SAVE.version`; older saves go through `migrate`. */
  version: number;
  /** Session seed. A save from a different seed is a different world, not a compatible one. */
  seed: number;
  /** The tick the snapshot was taken at. */
  tick: Tick;
  /** Slot label, e.g. 'autosave' or 'before-the-wolves'. */
  slot: string;
  /** Core's ECS state. */
  ecs: EcsSnapshot;
  /** Per-module blobs, keyed by module id. Modules register their own serializer. */
  modules: Record<string, unknown>;
  /** Event log for deterministic replay. Optional: manual saves may omit it to stay small. */
  events?: RecordedEvent[];
  /** Hash of the state at save time — a corrupted or truncated save is detected on load. */
  hash: string;
}

/** Anything a save can be rejected for. Loading returns one of these instead of throwing. */
export type SaveProblem =
  | { kind: 'not-found' }
  | { kind: 'unsupported-version'; version: number }
  | { kind: 'corrupt'; detail: string }
  | { kind: 'hash-mismatch'; expected: string; actual: string }
  | { kind: 'seed-mismatch'; expected: number; actual: number };

export type LoadResult =
  | { ok: true; save: SaveEnvelope; migratedFrom?: number }
  | { ok: false; problem: SaveProblem };

/** Shape checks. Deliberately structural: a save is data from disk, never to be trusted. */
export function looksLikeSave(value: unknown): value is SaveEnvelope {
  if (typeof value !== 'object' || value === null) return false;
  const save = value as Partial<SaveEnvelope>;
  return (
    typeof save.version === 'number' &&
    typeof save.seed === 'number' &&
    typeof save.tick === 'number' &&
    typeof save.ecs === 'object' &&
    save.ecs !== null
  );
}

/**
 * Walk an old save forward, one version at a time.
 *
 * v1 → v2: `modules` and `slot` were added. v1 saves predate per-module blobs, so they get an
 * empty record rather than being rejected — an old save should lose detail, never open a
 * dialogue box.
 */
export function migrate(save: SaveEnvelope): LoadResult {
  if (save.version > SAVE.version) {
    return { ok: false, problem: { kind: 'unsupported-version', version: save.version } };
  }
  if (save.version === SAVE.version) return { ok: true, save };

  const from = save.version;
  let current: SaveEnvelope = { ...save };

  if (current.version === 1) {
    current = {
      ...current,
      version: 2,
      slot: current.slot ?? SAVE.autosaveSlot,
      modules: current.modules ?? {},
    };
  }

  if (current.version !== SAVE.version) {
    return {
      ok: false,
      problem: { kind: 'corrupt', detail: `no migration path from v${from} to v${SAVE.version}` },
    };
  }
  return { ok: true, save: current, migratedFrom: from };
}
