/**
 * The reference simulation.
 *
 * Core has no gameplay of its own, but the ECS, the loop, save/load, and replay all need
 * *something* to be true of a world in order to be tested — and "10 000 entities at 20 Hz" is not
 * a property you can assert against an empty world. So core ships one small deterministic
 * simulation: a drifting shoal of creatures that ages, churns, and responds to player attacks.
 *
 * It is used by three debug scenes, the determinism tests, the save round-trip proof, and the perf
 * harness. It is NOT gameplay: `creatures` owns real bodies and `ecology` owns real populations.
 * When those land, this stays exactly where it is — the thing the engine is measured against.
 *
 * Determinism rules obeyed here, all of them checkable by CI:
 *   • every random draw comes from `rng.fork('core.sim')`, never from the shared stream
 *   • the only clock is the tick passed into `update`
 *   • iteration is by ascending entity slot, never over a `Set` or object key order
 */

import type { EventBus, GameEvent } from '@contracts/events';
import { regionId, speciesId, type EntityId, type Tick } from '@contracts/ids';
import type { Rng } from '@contracts/rng';
import { soa } from '../ecs/store';
import type { Component } from '@core/ecs/world';
import type { EcsWorld } from '@core/ecs/world';
import { defineSystem, ORDER, type System, type SystemContext } from '../ecs/system';
import { REF } from './reference.data';

const POSITION = { x: 'f32', y: 'f32', z: 'f32' } as const;
const VELOCITY = { x: 'f32', y: 'f32', z: 'f32' } as const;
const VITALS = { health: 'f32', age: 'u32', species: 'u8', phase: 'f32' } as const;

export type PositionComponent = Component<{ x: number; y: number; z: number }, ReturnType<typeof soa<typeof POSITION>>>;
export type VelocityComponent = Component<{ x: number; y: number; z: number }, ReturnType<typeof soa<typeof VELOCITY>>>;
export type VitalsComponent = Component<
  { health: number; age: number; species: number; phase: number },
  ReturnType<typeof soa<typeof VITALS>>
>;

export interface ReferenceSimOptions {
  world: EcsWorld;
  bus: EventBus;
  /** The core sub-stream. Pass `ctx.rng.fork('core')`; never the session rng. */
  rng: Rng;
  capacity?: number;
}

export interface ReferenceSimStats {
  alive: number;
  born: number;
  died: number;
  attacks: number;
}

export interface ReferenceSim {
  readonly position: PositionComponent;
  readonly velocity: VelocityComponent;
  readonly vitals: VitalsComponent;
  /** Deterministically fill the world with `count` creatures. Clears it first. */
  populate(count: number): void;
  /** Spawn a single creature from the sim's own rng stream. */
  spawnOne(): EntityId;
  systems(): readonly System[];
  stats(): ReferenceSimStats;
  /** Serializer for the save file — the sim's own counters, alongside the ECS snapshot. */
  capture(): unknown;
  restore(data: unknown): void;
  dispose(): void;
}

const REGION = regionId('core-debug');

export function createReferenceSim(options: ReferenceSimOptions): ReferenceSim {
  const { world, bus, rng } = options;
  const capacity = options.capacity ?? 1024;

  const position = world.defineComponent(soa('core.position', POSITION, capacity));
  const velocity = world.defineComponent(soa('core.velocity', VELOCITY, capacity));
  const vitals = world.defineComponent(soa('core.vitals', VITALS, capacity));

  const spawnRng = rng.fork('spawn');
  const churnRng = rng.fork('churn');

  const counters = { born: 0, died: 0, attacks: 0 };
  const moving = world.query({ all: [position, velocity, vitals] });

  const speciesOf = (index: number): string => REF.species[index % REF.species.length]!;

  const emit = (event: GameEvent): void => bus.emit(event);

  const spawnOne = (): EntityId => {
    // Golden-angle placement gives an even ring with no clumping, and it is a pure function of
    // the draw sequence — so the same seed lays out the same shoal on every machine.
    const angle = spawnRng.next() * Math.PI * 2;
    const radius = REF.fieldRadius * (0.35 + 0.6 * Math.sqrt(spawnRng.next()));
    const species = spawnRng.int(0, REF.species.length - 1);
    const id = world.create();
    const index = world.indexOf(id);
    world.add(id, position, {
      x: Math.cos(angle) * radius,
      y: 2 + spawnRng.next() * 8,
      z: Math.sin(angle) * radius,
    });
    world.add(id, velocity, {
      x: -Math.sin(angle) * REF.swirl,
      y: 0,
      z: Math.cos(angle) * REF.swirl,
    });
    world.add(id, vitals, {
      health: REF.health,
      age: 0,
      species,
      phase: spawnRng.next() * Math.PI * 2,
    });
    counters.born++;
    emit({
      type: 'creature:born',
      speciesId: speciesId(speciesOf(species)),
      entityId: id,
      pos: {
        x: position.store.field.x[index]!,
        y: position.store.field.y[index]!,
        z: position.store.field.z[index]!,
      },
      regionId: REGION,
    });
    return id;
  };

  const kill = (id: EntityId, cause: 'player' | 'age'): void => {
    const index = world.indexOf(id);
    if (index < 0) return;
    const pos = {
      x: position.store.field.x[index]!,
      y: position.store.field.y[index]!,
      z: position.store.field.z[index]!,
    };
    const species = vitals.store.field.species[index]!;
    world.destroy(id);
    counters.died++;
    emit({
      type: 'creature:died',
      speciesId: speciesId(speciesOf(species)),
      entityId: id,
      // An accurate cause is load-bearing: `ecology` only remembers 'player' kills, and the whole
      // premise of the game is the world remembering what the PLAYER did.
      cause,
      pos,
      regionId: REGION,
    });
  };

  // ------------------------------------------------------------------- systems

  const motion = defineSystem('core.motion', ORDER.simulation, (dt, ctx) => {
    const px = position.store.field.x;
    const py = position.store.field.y;
    const pz = position.store.field.z;
    const vx = velocity.store.field.x;
    const vy = velocity.store.field.y;
    const vz = velocity.store.field.z;
    const phase = vitals.store.field.phase;
    const tick = ctx.tick;

    moving.forEach((index) => {
      const x = px[index]!;
      const z = pz[index]!;
      const r = Math.sqrt(x * x + z * z) || 1e-4;
      const tx = -z / r;
      const tz = x / r;
      // Pull toward the ring at 0.7 R: negative inside, positive outside.
      const pull = (r - REF.fieldRadius * 0.7) * REF.cohesion;

      let nvx = (vx[index]! + (tx * REF.swirl - (x / r) * pull) * dt) * REF.damping;
      let nvz = (vz[index]! + (tz * REF.swirl - (z / r) * pull) * dt) * REF.damping;
      let nvy =
        (vy[index]! +
          (Math.sin(tick * REF.bobRate + phase[index]!) * REF.bobAmplitude - py[index]! * 0.25) *
            dt) *
        REF.damping;

      const speed = Math.sqrt(nvx * nvx + nvy * nvy + nvz * nvz);
      if (speed > REF.maxSpeed) {
        const scale = REF.maxSpeed / speed;
        nvx *= scale;
        nvy *= scale;
        nvz *= scale;
      }

      vx[index] = nvx;
      vy[index] = nvy;
      vz[index] = nvz;
      px[index] = x + nvx * dt;
      py[index] = py[index]! + nvy * dt;
      pz[index] = z + nvz * dt;
    });
  });

  const aging = defineSystem('core.aging', ORDER.ecology, (_dt, _ctx) => {
    const age = vitals.store.field.age;
    moving.forEach((index) => {
      age[index] = age[index]! + 1;
    });
  });

  /**
   * Churn: one creature dies of age and one is born, every `churnInterval` ticks. It keeps the
   * population steady, keeps the event log alive so the overlay has something to show, and gives
   * save/load a moving target instead of a static one.
   */
  const churn = defineSystem('core.churn', ORDER.reactions, (_dt, ctx) => {
    if (ctx.tick === 0 || ctx.tick % REF.churnInterval !== 0) return;
    for (let i = 0; i < REF.churnCount; i++) {
      const ids = moving.ids();
      if (ids.length === 0) break;
      kill(ids[churnRng.int(0, ids.length - 1)]!, 'age');
      spawnOne();
    }
  });

  // ------------------------------------------------------------------- input

  /**
   * The one external input the reference sim accepts. `replay` re-injects these from the log,
   * which is how "same seed + same input ⇒ same world" becomes a test instead of a claim.
   */
  const unsubscribe = bus.on(
    'player:attacked',
    (event) => {
      counters.attacks++;
      const index = world.indexOf(event.targetId);
      if (index < 0) return;
      const damage = event.damage > 0 ? event.damage : REF.defaultDamage;
      const health = vitals.store.field.health[index]! - damage * (event.isCrit ? 2 : 1);
      vitals.store.field.health[index] = health;
      if (health <= 0) kill(event.targetId, 'player');
    },
    'core.sim.attack',
  );

  return {
    position,
    velocity,
    vitals,

    populate(count) {
      world.clear();
      counters.born = 0;
      counters.died = 0;
      counters.attacks = 0;
      for (let i = 0; i < count; i++) spawnOne();
      // The births above are startup, not gameplay; reset so `stats()` reads as churn only.
      counters.born = 0;
    },

    spawnOne,

    systems: () => [motion, aging, churn],

    stats: () => ({ alive: world.count, ...counters }),

    capture: () => ({ ...counters, spawnRng: spawnRng.save(), churnRng: churnRng.save() }),

    restore(data) {
      if (typeof data !== 'object' || data === null) return;
      const blob = data as Partial<ReferenceSimStats> & { spawnRng?: number; churnRng?: number };
      counters.born = blob.born ?? 0;
      counters.died = blob.died ?? 0;
      counters.attacks = blob.attacks ?? 0;
      // Restoring the RNG cursors matters as much as restoring positions: a save that resumes
      // with a fresh stream diverges from the session that wrote it on the very next churn.
      if (typeof blob.spawnRng === 'number') spawnRng.restore(blob.spawnRng);
      if (typeof blob.churnRng === 'number') churnRng.restore(blob.churnRng);
    },

    dispose: unsubscribe,
  };
}

/** Convenience for tests: a system context bound to a world, bus, and rng. */
export function makeContext(
  base: Omit<SystemContext, 'tick'>,
  tick: Tick,
): SystemContext {
  return { ...base, tick };
}
