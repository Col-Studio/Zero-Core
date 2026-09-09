/**
 * The save manager: autosave cadence, manual slots, load with validation, and the round-trip
 * self-check the `?scene=save` debug scene renders.
 *
 * The autosave clock is measured in TICKS, not milliseconds. That is not pedantry — a wall-clock
 * autosave fires at a different tick on a fast machine than a slow one, so two players who did
 * exactly the same things would have different save files, and "replay this session" would stop
 * being reproducible. Simulated time is the only clock this module can see.
 */

import type { Tick } from '@contracts/ids';
import { SAVE } from '../core.data';
import { looksLikeSave, migrate, type LoadResult, type RecordedEvent, type SaveEnvelope } from './format';
import type { SnapshotSource } from './snapshot';
import type { SaveMeta, SaveStore } from './store';

export interface SaveManagerOptions {
  source: SnapshotSource;
  store: SaveStore;
  seed: number;
  /** Recorded input events to embed, for replayable saves. */
  events?: () => readonly RecordedEvent[];
  /** Autosave cadence override, in ticks. */
  intervalTicks?: number;
  autosave?: boolean;
}

export interface SaveStatus {
  lastSavedTick: Tick | null;
  lastLoadedTick: Tick | null;
  lastError: string | null;
  saves: number;
  loads: number;
  /** Ticks until the next autosave. */
  nextAutosaveIn: number;
  storeKind: SaveStore['kind'];
}

export interface RoundTripResult {
  ok: boolean;
  before: string;
  after: string;
  bytes: number;
  /** Module blobs in the save that no serializer claimed — expected before the merge. */
  unowned: string[];
}

export interface SaveManager {
  save(slot?: string, withEvents?: boolean): Promise<SaveEnvelope>;
  load(slot?: string): Promise<LoadResult>;
  list(): Promise<SaveMeta[]>;
  /** Feed the current tick; triggers an autosave when the cadence comes round. */
  onTick(tick: Tick): void;
  /** Save → read back → restore → compare hashes. The proof that "the world remembers". */
  verifyRoundTrip(slot?: string): Promise<RoundTripResult>;
  status(): SaveStatus;
  setAutosave(enabled: boolean): void;
}

export function createSaveManager(options: SaveManagerOptions): SaveManager {
  const interval = options.intervalTicks ?? SAVE.autosaveIntervalTicks;
  let autosaveEnabled = options.autosave ?? true;
  let lastAutosaveTick = 0;
  let currentTick: Tick = 0;
  let inFlight = false;

  const status: SaveStatus = {
    lastSavedTick: null,
    lastLoadedTick: null,
    lastError: null,
    saves: 0,
    loads: 0,
    nextAutosaveIn: interval,
    storeKind: options.store.kind,
  };

  const manager: SaveManager = {
    async save(slot = SAVE.autosaveSlot, withEvents = false) {
      const envelope = options.source.capture(
        slot,
        withEvents ? (options.events?.() ?? []) : undefined,
      );
      try {
        await options.store.put(envelope);
        status.lastSavedTick = envelope.tick;
        status.saves++;
        status.lastError = null;
      } catch (error) {
        status.lastError = error instanceof Error ? error.message : String(error);
        // Deliberately not rethrown: a failed autosave must not take the session down with it.
        console.error('[save] write failed:', error);
      }
      return envelope;
    },

    async load(slot = SAVE.autosaveSlot) {
      let raw: unknown;
      try {
        raw = await options.store.get(slot);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        status.lastError = detail;
        return { ok: false, problem: { kind: 'corrupt', detail } };
      }

      if (raw === null || raw === undefined) return { ok: false, problem: { kind: 'not-found' } };
      if (!looksLikeSave(raw)) {
        return { ok: false, problem: { kind: 'corrupt', detail: 'not a save envelope' } };
      }

      const migrated = migrate(raw);
      if (!migrated.ok) return migrated;
      const save = migrated.save;

      if (save.seed !== options.seed) {
        return {
          ok: false,
          problem: { kind: 'seed-mismatch', expected: options.seed, actual: save.seed },
        };
      }

      options.source.apply(save);
      const actual = options.source.hash();
      if (save.hash !== actual) {
        // The world is already loaded at this point; report rather than pretend. A mismatch means
        // a module's serializer is lossy, and silently continuing hides exactly the bug that makes
        // "the world remembers" untrue.
        return { ok: false, problem: { kind: 'hash-mismatch', expected: save.hash, actual } };
      }

      status.lastLoadedTick = save.tick;
      status.loads++;
      return migrated;
    },

    list: () => options.store.list(),

    onTick(tick) {
      currentTick = tick;
      status.nextAutosaveIn = Math.max(0, interval - (tick - lastAutosaveTick));
      if (!autosaveEnabled || inFlight) return;
      if (tick - lastAutosaveTick < interval) return;
      lastAutosaveTick = tick;
      inFlight = true;
      void manager
        .save(SAVE.autosaveSlot, true)
        .finally(() => {
          inFlight = false;
        });
    },

    async verifyRoundTrip(slot = 'roundtrip') {
      const before = options.source.hash();
      const envelope = await manager.save(slot, false);
      const reloaded = await options.store.get(slot);
      if (reloaded === null) {
        return { ok: false, before, after: '', bytes: 0, unowned: [] };
      }
      const applied = options.source.apply(reloaded);
      const after = options.source.hash();
      return {
        ok: before === after && envelope.hash === after,
        before,
        after,
        bytes: JSON.stringify(reloaded).length,
        unowned: applied.unowned,
      };
    },

    status() {
      return { ...status, nextAutosaveIn: Math.max(0, interval - (currentTick - lastAutosaveTick)) };
    },

    setAutosave(enabled) {
      autosaveEnabled = enabled;
    },
  };

  return manager;
}
