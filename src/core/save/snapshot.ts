/**
 * The snapshot registry — how seven modules end up in one save file without core knowing
 * anything about six of them.
 *
 * Each module registers `{ id, capture(), restore(data) }`. Core registers the ECS itself. At
 * save time every serializer is called in a fixed id order (sorted, not registration order, so
 * the byte layout of a save does not depend on module mount order); at load time each blob goes
 * back to its owner, and a blob whose owner is absent is *kept* rather than dropped, so loading
 * a full-game save in a single-module dev harness and saving it again does not silently delete
 * the other six modules' worlds.
 */

import { hashState } from '@contracts/rng';
import type { Tick } from '@contracts/ids';
import type { EcsWorld } from '@core/ecs/world';
import { SAVE } from '../core.data';
import type { SaveEnvelope, RecordedEvent } from './format';

export interface ModuleSerializer {
  /** Module id: 'world', 'ecology', … Must be stable across builds; it is a save-file key. */
  readonly id: string;
  capture(): unknown;
  restore(data: unknown): void;
}

export interface SnapshotOptions {
  seed: number;
  world: EcsWorld;
  getTick: () => Tick;
}

export interface SnapshotSource {
  register(serializer: ModuleSerializer): () => void;
  registered(): readonly string[];
  /** Build a save envelope for the current state. */
  capture(slot: string, events?: readonly RecordedEvent[]): SaveEnvelope;
  /** Apply an envelope to the live world. Returns the ids that had no serializer registered. */
  apply(save: SaveEnvelope): { unowned: string[]; ignoredComponents: string[] };
  /** Hash of everything a save would contain. The determinism assertion. */
  hash(): string;
}

export function createSnapshotSource(options: SnapshotOptions): SnapshotSource {
  const serializers = new Map<string, ModuleSerializer>();
  /** Blobs from a loaded save whose module is not present in this build. Preserved verbatim. */
  let orphans: Record<string, unknown> = {};

  const captureModules = (): Record<string, unknown> => {
    const out: Record<string, unknown> = { ...orphans };
    for (const id of [...serializers.keys()].sort()) {
      const serializer = serializers.get(id)!;
      try {
        out[id] = serializer.capture();
      } catch (error) {
        console.error(`[save] module '${id}' failed to capture; saving null for it:`, error);
        out[id] = null;
      }
    }
    return out;
  };

  const source: SnapshotSource = {
    register(serializer) {
      if (serializers.has(serializer.id)) {
        throw new Error(`save: module '${serializer.id}' already registered a serializer`);
      }
      serializers.set(serializer.id, serializer);
      // A module that registers after a load takes ownership of its orphaned blob.
      const pending = orphans[serializer.id];
      if (pending !== undefined) {
        delete orphans[serializer.id];
        serializer.restore(pending);
      }
      return () => serializers.delete(serializer.id);
    },

    registered: () => [...serializers.keys()].sort(),

    capture(slot, events) {
      const ecs = options.world.snapshot();
      const modules = captureModules();
      const envelope: SaveEnvelope = {
        version: SAVE.version,
        seed: options.seed,
        tick: options.getTick(),
        slot,
        ecs,
        modules,
        hash: hashState({ ecs, modules }),
      };
      if (events !== undefined && events.length > 0) envelope.events = [...events];
      return envelope;
    },

    apply(save) {
      const { ignored } = options.world.restore(save.ecs);
      const unowned: string[] = [];
      const nextOrphans: Record<string, unknown> = {};
      for (const [id, data] of Object.entries(save.modules ?? {})) {
        const serializer = serializers.get(id);
        if (serializer === undefined) {
          unowned.push(id);
          nextOrphans[id] = data;
          continue;
        }
        try {
          serializer.restore(data);
        } catch (error) {
          console.error(`[save] module '${id}' failed to restore:`, error);
        }
      }
      orphans = nextOrphans;
      return { unowned, ignoredComponents: ignored };
    },

    hash() {
      return hashState({ ecs: options.world.snapshot(), modules: captureModules() });
    },
  };

  return source;
}
