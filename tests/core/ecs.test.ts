/**
 * ECS unit tests. These are the properties every other module is built on: entity ids are
 * generation-safe, component data lands in typed arrays a hot loop can index directly, queries
 * match by mask, and the whole world hashes to a string that survives identical runs.
 */

import { describe, expect, it } from 'vitest';
import { NO_ENTITY } from '@contracts/ids';
import { EcsWorld } from '@core/ecs/world';
import { soa, objects } from '@core/ecs/store';
import {
  packEntity,
  entityIndex,
  entityGeneration,
  MAX_GENERATION,
} from '@core/ecs/entity';

describe('entity ids', () => {
  it('round-trips index and generation', () => {
    const id = packEntity(1234, 7);
    expect(entityIndex(id)).toBe(1234);
    expect(entityGeneration(id)).toBe(7);
  });

  it('recycles slots with a bumped generation', () => {
    const world = new EcsWorld(16);
    const a = world.create();
    expect(world.destroy(a)).toBe(true);
    const b = world.create();
    // Same slot, new generation: `a` is now detectably stale instead of silently aliasing `b`.
    expect(entityIndex(b)).toBe(entityIndex(a));
    expect(entityGeneration(b)).toBe((entityGeneration(a) + 1) % (MAX_GENERATION + 1));
    expect(world.isAlive(a)).toBe(false);
    expect(world.isAlive(b)).toBe(true);
  });

  it('rejects garbage ids', () => {
    const world = new EcsWorld(16);
    expect(world.isAlive(NO_ENTITY)).toBe(false);
    expect(world.isAlive(-5)).toBe(false);
    expect(world.destroy(NO_ENTITY)).toBe(false);
  });

  it('grows past the initial capacity', () => {
    const world = new EcsWorld(8);
    const ids: number[] = [];
    for (let i = 0; i < 100; i++) ids.push(world.create());
    expect(world.count).toBe(100);
    expect(new Set(ids).size).toBe(100);
  });
});

describe('components and queries', () => {
  const makeWorld = () => {
    const world = new EcsWorld();
    const position = world.defineComponent(
      soa('test.position', { x: 'f32', y: 'f32', z: 'f32' } as const, 128),
    );
    const health = world.defineComponent(soa('test.health', { hp: 'f32' } as const, 128));
    const meta = world.defineComponent(
      objects('test.meta', () => ({ label: '' }), 128),
    );
    return { world, position, health, meta };
  };

  it('writes and reads SoA rows through the typed arrays', () => {
    const { world, position } = makeWorld();
    const id = world.spawn([position, { x: 1.5, y: 2.5, z: 3.5 }]);
    const index = world.indexOf(id);
    expect(position.store.field.x[index]).toBe(1.5);
    expect(position.store.field.y[index]).toBe(2.5);
  });

  it('queries by mask — all, none, and mixed', () => {
    const { world, position, health } = makeWorld();
    const withBoth = world.spawn([position, { x: 1 }], [health, { hp: 10 }]);
    const onlyPosition = world.spawn([position, { x: 2 }]);
    const onlyHealth = world.spawn([health, { hp: 20 }]);

    expect(world.query({ all: [position, health] }).ids()).toEqual([withBoth]);
    // `none` excludes everything carrying health — only the position-only entity survives.
    expect(world.query({ none: [health] }).ids()).toEqual([onlyPosition]);
    expect(world.query({ all: [health] }).ids().sort()).toEqual([withBoth, onlyHealth].sort());
  });

  it('object stores snapshot and restore without aliasing', () => {
    const { world, meta } = makeWorld();
    const id = world.spawn([meta, { label: 'wolf' }]);
    const index = world.indexOf(id);
    const row = meta.store.read(index);
    row.label = 'mutated';
    expect(meta.store.read(index).label).toBe('wolf');
    expect(meta.store.at(index)?.label).toBe('wolf');
  });

  it('destroy clears every component and removes the entity from queries', () => {
    const { world, position, health } = makeWorld();
    const id = world.spawn([position, { x: 9 }], [health, { hp: 5 }]);
    expect(world.destroy(id)).toBe(true);
    expect(world.query({ all: [position] }).count()).toBe(0);
    expect(world.query({ all: [health] }).count()).toBe(0);
    // Double destroy is a no-op, not an error: callers race on kills.
    expect(world.destroy(id)).toBe(false);
  });
});

describe('snapshot and restore', () => {
  const build = () => {
    const world = new EcsWorld(64);
    const position = world.defineComponent(
      soa('test.position', { x: 'f32', y: 'f32', z: 'f32' } as const, 64),
    );
    const meta = world.defineComponent(
      objects('test.meta', () => ({ label: '' }), 64),
    );
    return { world, position, meta };
  };

  it('hashes identically for identical worlds', () => {
    const a = build();
    const b = build();
    for (const target of [a, b]) {
      for (let i = 0; i < 20; i++) {
        target.world.spawn([target.position, { x: i, y: i * 2, z: i * 3 }]);
      }
    }
    expect(a.world.hash()).toBe(b.world.hash());
  });

  it('hashes differently when anything changes', () => {
    const a = build();
    const b = build();
    for (const target of [a, b]) {
      target.world.spawn([target.position, { x: 1, y: 2, z: 3 }]);
    }
    const id = b.world.query({ all: [b.position] }).first()!;
    b.world.set(id, b.position, { x: 1.001 });
    expect(a.world.hash()).not.toBe(b.world.hash());
  });

  it('restores byte-identically, including entity generations', () => {
    const a = build();
    const first = a.world.spawn([a.position, { x: 1, y: 2, z: 3 }], [a.meta, { label: 'one' }]);
    a.world.spawn([a.position, { x: 4, y: 5, z: 6 }], [a.meta, { label: 'two' }]);
    a.world.destroy(first); // create a hole so the free list is non-trivial
    // The third spawn recycles the destroyed slot — its own meta must win, not the
    // previous occupant's.
    const third = a.world.spawn([a.position, { x: 7, y: 8, z: 9 }], [a.meta, { label: 'three' }]);

    const snapshot = a.world.snapshot();
    const hash = a.world.hash();

    const b = build();
    b.world.restore(snapshot);
    expect(b.world.hash()).toBe(hash);
    expect(b.world.isAlive(first)).toBe(false);
    expect(b.world.isAlive(third)).toBe(true);
    expect(b.world.get(third, b.meta)).toEqual({ label: 'three' });
  });

  it('reports components it cannot restore rather than throwing', () => {
    const a = build();
    a.world.spawn([a.position, { x: 1, y: 1, z: 1 }]);
    const snapshot = JSON.parse(JSON.stringify(a.world.snapshot())) as ReturnType<
      typeof a.world.snapshot
    >;
    snapshot.components['from.a.newer.build'] = [[0, {}]];

    const b = build();
    const { ignored } = b.world.restore(snapshot);
    expect(ignored).toEqual(['from.a.newer.build']);
    expect(b.world.count).toBe(1);
  });
});

describe('hot path', () => {
  it('iterates 10 000 entities in a few milliseconds', () => {
    const world = new EcsWorld(16_384);
    const position = world.defineComponent(
      soa('bench.position', { x: 'f32', y: 'f32', z: 'f32' } as const, 16_384),
    );
    const velocity = world.defineComponent(
      soa('bench.velocity', { x: 'f32', y: 'f32', z: 'f32' } as const, 16_384),
    );
    const ids: number[] = [];
    for (let i = 0; i < 10_000; i++) {
      ids.push(world.spawn([position, { x: i, y: 0, z: 0 }], [velocity, { x: 1, y: 0, z: 0 }]));
    }

    const start = performance.now();
    for (let step = 0; step < 20; step++) {
      const px = position.store.field.x;
      const vx = velocity.store.field.x;
      for (let index = 0, n = world.slotCount; index < n; index++) {
        if (!world.isSlotAlive(index)) continue;
        px[index] = px[index]! + vx[index]! * 0.05;
      }
    }
    const elapsed = performance.now() - start;
    // 200 000 entity-updates. Budget is generous — CI machines are slow — but the point of the
    // SoA design is that this is single-digit, not "passes eventually".
    expect(elapsed).toBeLessThan(200);
    expect(world.count).toBe(10_000);
  });
});
