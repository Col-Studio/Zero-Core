/**
 * Null actors — creatures, player, society, presentation — plus the registry swap that turns
 * Nulls into real modules at merge time. See `nulls-world.test.ts` for the rationale.
 */

import { describe, expect, it } from 'vitest';
import {
  createNullCreatureQuery,
  createNullPlayerQuery,
  createNullPresentation,
  createNullServices,
  createNullSocietyQuery,
  createNullWorldQuery,
} from '@contracts/nulls';
import { createServiceRegistry } from '@contracts/registry';
import { speciesId, vec3, type Tick } from '@contracts/ids';

describe('NullCreatureQuery', () => {
  const DUMMY = speciesId('training_dummy');
  const dummiesOf = (creatures: ReturnType<typeof createNullCreatureQuery>) =>
    creatures.getNearby(vec3(0, 0, 0), 500, { species: [DUMMY] });

  it('provides stationary training dummies for combat development', () => {
    const world = createNullWorldQuery();
    const creatures = createNullCreatureQuery(() => 0);
    const dummies = dummiesOf(creatures);
    expect(dummies).toHaveLength(4);

    for (const dummy of dummies) {
      // Sitting on the terrain, not floating at y=0 — Member 5's hitboxes must line up.
      expect(dummy.pos.y).toBeCloseTo(world.getHeightAt(dummy.pos.x, dummy.pos.z), 4);
      expect(dummy.velocity).toEqual(vec3());
    }

    // Positions must not move with tick — Member 5 needs predictable targets.
    const later = dummiesOf(createNullCreatureQuery(() => 9999));
    expect(later.map((d) => d.pos)).toEqual(dummies.map((d) => d.pos));
  });

  it('moves non-dummy creatures over time', () => {
    let tick: Tick = 0;
    const creatures = createNullCreatureQuery(() => tick);
    const wolves = () => creatures.getNearby(vec3(0, 0, 0), 500, { species: [speciesId('wolf')] });
    const start = wolves()[0]!.pos;
    tick = 600;
    expect(wolves()[0]!.pos).not.toEqual(start);
  });

  it('applies damage with resistances and crits', () => {
    const creatures = createNullCreatureQuery(() => 0);
    const bear = creatures.getActiveBosses()[0];
    expect(bear).toBeDefined();

    // Armoured apex: resistant to slash, weak to blunt.
    expect(creatures.applyDamage(bear!.entityId, 100, 'slash', false)).toBeLessThan(100);
    expect(creatures.applyDamage(bear!.entityId, 100, 'blunt', false)).toBeGreaterThan(100);

    const crit = creatures.applyDamage(bear!.entityId, 10, 'blunt', true);
    const normal = creatures.applyDamage(bear!.entityId, 10, 'blunt', false);
    expect(crit).toBeCloseTo(normal * 2, 5);
  });

  it('keeps training dummies alive so combat tuning never runs out of targets', () => {
    const creatures = createNullCreatureQuery(() => 0);
    const dummy = dummiesOf(creatures)[0]!;
    for (let i = 0; i < 50; i++) creatures.applyDamage(dummy.entityId, 500, 'slash', true);
    expect(creatures.getEntity(dummy.entityId)!.health).toBeGreaterThan(0);
  });

  it('respects filters and the limit', () => {
    const creatures = createNullCreatureQuery(() => 0);
    const hostile = creatures.getNearby(vec3(0, 0, 0), 500, { hostileOnly: true });
    expect(hostile.length).toBeGreaterThan(0);
    expect(hostile.every((c) => c.isHostile)).toBe(true);

    expect(creatures.getNearby(vec3(0, 0, 0), 500, { limit: 2 })).toHaveLength(2);
  });

  it('spawns, counts, and despawns', () => {
    const creatures = createNullCreatureQuery(() => 0);
    const before = creatures.getPopulationCount();
    const id = creatures.spawn(speciesId('hare'), vec3(3, 0, 3));
    expect(creatures.getPopulationCount()).toBe(before + 1);
    expect(creatures.getEntity(id)).not.toBeNull();

    creatures.despawn(id);
    expect(creatures.getEntity(id)).toBeNull();
  });

  it('returns null for unknown entities rather than throwing', () => {
    expect(createNullCreatureQuery().getEntity(999_999)).toBeNull();
    expect(createNullCreatureQuery().applyDamage(999_999, 10, 'slash', false)).toBe(0);
  });
});

describe('NullPlayerQuery', () => {
  it('orbits so world streaming and creature perception have a moving focus', () => {
    let tick: Tick = 0;
    const player = createNullPlayerQuery(() => tick);
    const start = player.getPosition();
    tick = 1200;
    const later = player.getPosition();
    expect(Math.hypot(later.x - start.x, later.z - start.z)).toBeGreaterThan(10);
  });

  it('stays on the terrain surface at eye height', () => {
    let tick: Tick = 0;
    const player = createNullPlayerQuery(() => tick);
    const world = createNullWorldQuery();
    for (tick = 0; tick < 4800; tick += 400) {
      const pos = player.getPosition();
      expect(pos.y).toBeCloseTo(world.getHeightAt(pos.x, pos.z) + 1.7, 4);
    }
  });

  it('is immortal so bosses can be developed safely', () => {
    const player = createNullPlayerQuery();
    player.applyDamage(9999, 'boss');
    expect(player.getHealth().current).toBe(100);
  });
});

describe('NullSocietyQuery', () => {
  const society = createNullSocietyQuery();

  it('provides villages grounded on the terrain, each with an economy', () => {
    const world = createNullWorldQuery();
    const villages = society.getAllVillages();
    expect(villages.length).toBeGreaterThanOrEqual(3);
    for (const village of villages) {
      expect(village.name.length).toBeGreaterThan(3);
      expect(village.pos.y).toBeCloseTo(world.getHeightAt(village.pos.x, village.pos.z), 4);
      expect(society.getEconomy(village.id)).not.toBeNull();
    }
  });

  it('finds villages by radius', () => {
    expect(society.getVillagesNear(vec3(80, 0, 40), 400).length).toBeGreaterThan(0);
    expect(society.getVillagesNear(vec3(9000, 0, 9000), 10)).toHaveLength(0);
  });

  it('models opposed factions', () => {
    const verdant = society.getFactionList().find((f) => f.name === 'Verdant Order')!;
    const iron = society.getFactionList().find((f) => f.name === 'Iron Guild')!;
    expect(society.getFactionRelation(verdant.id, iron.id)).toBeLessThan(0);
    expect(society.getFactionRelation(verdant.id, verdant.id)).toBe(1);
  });

  it('offers an acceptable mission that references a real village', () => {
    const fresh = createNullSocietyQuery();
    const mission = fresh.getOfferedMissions()[0];
    expect(mission).toBeDefined();
    expect(mission!.objectives.length).toBeGreaterThan(0);
    expect(mission!.objectives[0]!.target).toBeGreaterThan(0);
    expect(fresh.getVillage(mission!.villageId)).not.toBeNull();

    expect(fresh.acceptMission(mission!.id)).toBe(true);
    expect(fresh.getActiveMissions()).toHaveLength(1);
    expect(fresh.acceptMission(mission!.id)).toBe(false); // not twice
  });
});

describe('NullPresentation', () => {
  it('records calls and never throws on an unimplemented effect kind', () => {
    const presentation = createNullPresentation();
    expect(() => {
      presentation.requestVfx('a-kind-nobody-implemented', vec3(0, 0, 0));
      presentation.requestSfx('mystery-sound');
      presentation.setWeatherVisual('rain', 0.5);
      presentation.showToast('hello', 'discovery');
      presentation.shakeCamera(0.3, 6);
      presentation.requestHitstop(3);
    }).not.toThrow();

    expect(presentation.drained()).toHaveLength(6);
    expect(presentation.drained()).toHaveLength(0); // drain clears
  });

  it('bounds its buffer so a spamming module cannot leak memory', () => {
    const presentation = createNullPresentation();
    for (let i = 0; i < 5000; i++) presentation.requestVfx('spam', vec3());
    expect(presentation.drained().length).toBeLessThanOrEqual(512);
  });
});

describe('createNullServices + ServiceRegistry', () => {
  it('supplies all six services', () => {
    const services = createNullServices(() => 100);
    expect(services.world().getHeightAt(0, 0)).toBeTypeOf('number');
    expect(services.ecology().getSpeciesList().length).toBeGreaterThan(0);
    expect(services.creatures().getPopulationCount()).toBeGreaterThan(0);
    expect(services.player().getPosition()).toBeDefined();
    expect(services.society().getAllVillages().length).toBeGreaterThan(0);
    expect(() => services.presentation().showToast('ok')).not.toThrow();
  });

  it('defaults to Nulls and swaps one service at a time', () => {
    const registry = createServiceRegistry({ warnOnNullAccess: false });
    expect(registry.isReal('world')).toBe(false);
    expect(registry.status().world).toBe('null');

    registry.register('world', { ...createNullWorldQuery(), getHeightAt: () => 999 });

    expect(registry.isReal('world')).toBe(true);
    expect(registry.world().getHeightAt(0, 0)).toBe(999);
    // Swapping one service must not affect the others — this is what makes the merge incremental.
    expect(registry.isReal('ecology')).toBe(false);
  });

  it('reverts to the Null on unregister, for bisecting a bad merge', () => {
    const registry = createServiceRegistry({ warnOnNullAccess: false });
    registry.register('world', { ...createNullWorldQuery(), getHeightAt: () => 999 });
    registry.unregister('world');
    expect(registry.world().getHeightAt(0, 0)).not.toBe(999);
  });

  it('resolves lazily so a post-merge swap reaches already-mounted modules', () => {
    const registry = createServiceRegistry({ warnOnNullAccess: false });
    // A module that correctly holds the accessor rather than the resolved service.
    const moduleReadsHeight = () => registry.world().getHeightAt(0, 0);
    const beforeSwap = moduleReadsHeight();

    registry.register('world', { ...createNullWorldQuery(), getHeightAt: () => 12_345 });
    expect(moduleReadsHeight()).toBe(12_345);
    expect(moduleReadsHeight()).not.toBe(beforeSwap);
  });

  it('reports all six statuses for the debug overlay', () => {
    const status = createServiceRegistry({ warnOnNullAccess: false }).status();
    expect(Object.keys(status)).toHaveLength(6);
    expect(Object.values(status).every((s) => s === 'null')).toBe(true);
  });
});
