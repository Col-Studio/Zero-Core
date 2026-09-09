/**
 * Save / load / replay tests — the "world remembers" guarantee, stated as assertions:
 *   • save → load → hash equals the pre-save hash (card requirement)
 *   • the save format is versioned and migrations run
 *   • replay from an event log reproduces identical state (card requirement)
 *   • a save from a different seed is refused, not silently loaded
 *
 * All storage here is the memory store: these tests are about correctness of the format and the
 * restore path, not about IndexedDB, which the browser tests cover end to end.
 */

import { describe, expect, it } from 'vitest';
import { createRng, hashState } from '@contracts/rng';
import { createEventBus } from '@contracts/events';
import { EcsWorld } from '@core/ecs/world';
import { SystemScheduler } from '@core/ecs/system';
import { createReferenceSim } from '@core/sim/reference';
import { createSnapshotSource } from '@core/save/snapshot';
import { createSaveManager } from '@core/save/manager';
import { createMemorySaveStore } from '@core/save/store';
import { createRecorder, replay } from '@core/save/replay';
import { looksLikeSave, migrate } from '@core/save/format';
import { SAVE } from '@core/core.data';
import type { Tick } from '@contracts/ids';

/** A complete, running simulation — the thing a save has to capture. */
function makeSim(seed = 1234, entities = 120) {
  const world = new EcsWorld(1024);
  const bus = createEventBus();
  const rng = createRng(seed);
  const sim = createReferenceSim({ world, bus, rng, capacity: 2048 });
  const scheduler = new SystemScheduler();
  for (const system of sim.systems()) scheduler.add(system);
  sim.populate(entities);

  let tick: Tick = 0;
  const step = (n = 1): void => {
    for (let i = 0; i < n; i++) {
      bus.setTick(tick);
      scheduler.step(1 / 20, { world, bus, rng, services: dummyServices, tick });
      tick++;
    }
  };

  return { world, bus, rng, sim, scheduler, step, getTick: () => tick, setTick: (t: Tick) => (tick = t), ...sim };
}

// The systems under test never resolve a service; the shape only has to satisfy the type.
const dummyServices = new Proxy({} as never, {
  get() {
    throw new Error('reference sim must not touch services');
  },
}) as never;

const makeManager = (sim: ReturnType<typeof makeSim>, seed = 1234, store = createMemorySaveStore()) => {
  const source = createSnapshotSource({ seed, world: sim.world, getTick: sim.getTick });
  source.register({ id: 'core', capture: sim.capture, restore: sim.restore });
  return createSaveManager({
    source,
    store,
    seed,
  });
};

describe('save and load', () => {
  it('save → load → hash equals the pre-save hash', async () => {
    const sim = makeSim();
    sim.step(37); // some churn has happened
    const manager = makeManager(sim);

    const before = sim.world.hash();
    await manager.save('test');
    const result = await manager.load('test');

    expect(result.ok).toBe(true);
    expect(sim.world.hash()).toBe(before);
  });

  it('restores mid-simulation state exactly — positions, ages, and rng cursors', async () => {
    const sim = makeSim();
    sim.step(120);
    const manager = makeManager(sim);
    await manager.save('test');

    const positionAtSave = sim.world.hash();
    const vitals = sim.vitals.store.field.age.slice();

    sim.step(400); // the world drifts on
    expect(sim.world.hash()).not.toBe(positionAtSave);

    await manager.load('test');
    expect(sim.world.hash()).toBe(positionAtSave);
    // Ages are part of the hash, but assert them directly: they are the subtlest restore.
    expect([...sim.vitals.store.field.age]).toEqual([...vitals]);
  });

  it('refuses a save from a different seed', async () => {
    const sim = makeSim(1234);
    sim.step(10);
    const store = createMemorySaveStore();
    const writer = makeManager(sim, 1234, store);
    await writer.save('test');

    const otherWorld = makeSim(999);
    const reader = makeManager(otherWorld, 999, store);
    const result = await reader.load('test');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem.kind).toBe('seed-mismatch');
  });

  it('detects a corrupted save by hash instead of loading garbage', async () => {
    const sim = makeSim();
    sim.step(10);
    const source = createSnapshotSource({ seed: 1234, world: sim.world, getTick: sim.getTick });
    source.register({ id: 'core', capture: sim.capture, restore: sim.restore });
    const store = createMemorySaveStore();
    const manager = createSaveManager({ source, store, seed: 1234 });
    await manager.save('test');

    const saved = await store.get('test');
    saved!.ecs.entities.alive[3] = 0; // flip an alive flag behind the writer's back
    await store.put(saved!);

    const result = await manager.load('test');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem.kind).toBe('hash-mismatch');
  });

  it('keeps blobs for modules that are not present in this build', async () => {
    const sim = makeSim();
    const source = createSnapshotSource({ seed: 1, world: sim.world, getTick: sim.getTick });
    const store = createMemorySaveStore();
    const manager = createSaveManager({ source, store, seed: 1 });

    // A save written by a build that had an `ecology` module.
    const orphanEcs = sim.world.snapshot();
    const orphanModules = { ecology: { regions: { meadow: { deer: 40 } } } };
    await store.put({
      version: SAVE.version,
      seed: 1,
      tick: 5,
      slot: 'full-game',
      ecs: orphanEcs,
      modules: orphanModules,
      hash: hashState({ ecs: orphanEcs, modules: orphanModules }),
    });

    const result = await manager.load('full-game');
    expect(result.ok).toBe(true);
    // Round-trip it again: the orphaned blob must still be there, not silently dropped.
    const again = await store.get('full-game');
    expect((again!.modules['ecology'] as unknown as Record<string, unknown>).regions).toBeDefined();
  });
});

describe('save format', () => {
  it('validates the envelope structurally', () => {
    expect(looksLikeSave({ version: 2, seed: 1, tick: 0 })).toBe(false);
    expect(
      looksLikeSave({ version: 2, seed: 1, tick: 0, ecs: {}, modules: {}, slot: 'x', hash: 'h' }),
    ).toBe(true);
    expect(looksLikeSave(null)).toBe(false);
    expect(looksLikeSave('save')).toBe(false);
  });

  it('migrates v1 saves forward instead of rejecting them', () => {
    const v1 = {
      version: 1,
      seed: 7,
      tick: 99,
      ecs: { used: 0, entities: { capacity: 0, alive: [], generations: [], free: [] }, masks: [], components: {} },
      hash: 'h',
    };
    const result = migrate(v1 as never);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.save.version).toBe(SAVE.version);
      expect(result.migratedFrom).toBe(1);
    }
  });

  it('refuses saves from the future with a clear reason', () => {
    const future = { version: SAVE.version + 3, seed: 1, tick: 0, ecs: {}, hash: 'h' };
    const result = migrate(future as never);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem.kind).toBe('unsupported-version');
  });
});

describe('replay', () => {
  it('replaying the recorded log reproduces identical state', () => {
    const sim = makeSim(77, 150);
    const recorder = createRecorder(sim.bus);

    // A "player" mashes attacks on live entities for 3 simulated seconds.
    sim.step(60);
    for (let i = 0; i < 12; i++) {
      sim.step(5);
      const ids = sim.world
        .query({ all: [sim.position] })
        .ids();
      if (ids.length === 0) continue;
      sim.bus.emit({
        type: 'player:attacked',
        targetId: ids[i % ids.length]!,
        damage: 60,
        style: 'blade',
        damageType: 'slash',
        isCrit: i % 3 === 0,
        pos: { x: 0, y: 0, z: 0 },
      });
    }
    sim.step(1);

    const events = recorder.events();
    expect(events.length).toBeGreaterThan(0);
    const finalTick = sim.getTick();
    const finalHash = sim.world.hash();

    // Replay the whole thing from tick 0 in a fresh world with the same seed.
    const replayed = makeSim(77, 150);
    const replayRecorder = createRecorder(replayed.bus);
    const injected = replay({
      bus: replayed.bus,
      events,
      step: (tick) => {
        replayed.bus.setTick(tick);
        replayed.scheduler.step(1 / 20, {
          world: replayed.world,
          bus: replayed.bus,
          rng: replayed.rng,
          services: dummyServices,
          tick,
        });
        // The sim's counter means "the next tick to run" — advance it after the step,
        // exactly the way makeSim's own step() does.
        replayed.setTick((tick + 1) as Tick);
      },
      fromTick: 0,
      toTick: finalTick,
    });

    expect(injected).toBe(events.length);
    expect(replayed.world.hash()).toBe(finalHash);
    expect(replayed.getTick()).toBe(finalTick);
    replayRecorder.dispose();
    recorder.dispose();
  });

  it('injects input on the exact tick it was recorded', () => {
    const bus = createEventBus();
    const seen: number[] = [];
    bus.on('player:attacked', (event) => seen.push(event.tick), 'test');
    let steps = 0;
    replay({
      bus,
      events: [
        { tick: 3, seq: 0, event: { type: 'player:attacked', targetId: 1, damage: 1, style: 'blade', damageType: 'slash', isCrit: false, pos: { x: 0, y: 0, z: 0 } } },
        { tick: 3, seq: 1, event: { type: 'player:attacked', targetId: 2, damage: 1, style: 'blade', damageType: 'slash', isCrit: false, pos: { x: 0, y: 0, z: 0 } } },
        { tick: 7, seq: 2, event: { type: 'player:attacked', targetId: 3, damage: 1, style: 'blade', damageType: 'slash', isCrit: false, pos: { x: 0, y: 0, z: 0 } } },
      ],
      step: () => steps++,
      fromTick: 0,
      toTick: 10,
    });
    expect(steps).toBe(10);
    expect(seen).toEqual([3, 3, 7]); // same tick, recorded order preserved
  });

  it('only records input events, never consequences', () => {
    const bus = createEventBus({ logCapacity: 0 });
    const recorder = createRecorder(bus);
    bus.emit({
      type: 'player:attacked',
      targetId: 1,
      damage: 1,
      style: 'blade',
      damageType: 'slash',
      isCrit: false,
      pos: { x: 0, y: 0, z: 0 },
    });
    bus.emit({
      type: 'creature:died',
      speciesId: 'wolf' as never,
      entityId: 1,
      cause: 'player',
      pos: { x: 0, y: 0, z: 0 },
      regionId: 'r' as never,
    });
    expect(recorder.count()).toBe(1);
    expect(recorder.events()[0]!.event.type).toBe('player:attacked');
    recorder.dispose();
  });
});
