/**
 * FROZEN — integration lead only. See CLAUDE.md § Frozen files.
 *
 * Null creatures. A handful of dummy bodies orbiting the origin on fixed deterministic paths.
 *
 * Member 5 (player/combat) uses these as practice targets for the entire project, so they are
 * not inert markers: they have health, resistances, hostility, and they respond to damage and
 * die. A combat system tuned against these will work against the real creatures.
 */

import type { CreatureFilter, CreatureInfo, ICreatureQuery } from '../services';
import {
  dist2,
  speciesId as toSpeciesId,
  vec3,
  type DamageType,
  type EntityId,
  type SpeciesId,
  type Tick,
  type TrophicTier,
  type Vec3,
} from '../ids';
import { nullHeightAt } from './world';

interface Dummy {
  entityId: EntityId;
  speciesId: SpeciesId;
  tier: TrophicTier;
  maxHealth: number;
  health: number;
  hostile: boolean;
  /** Orbit parameters — deterministic motion with no stored velocity integration. */
  orbitRadius: number;
  orbitSpeed: number;
  orbitPhase: number;
  /** Set for stationary training dummies, which are far easier to tune combat against. */
  fixedAt?: Vec3;
}

const RESIST: Record<DamageType, number> = { slash: 1, blunt: 1, pierce: 1 };
const ARMORED: Record<DamageType, number> = { slash: 0.6, blunt: 1.4, pierce: 0.8 };

export function createNullCreatureQuery(getTick: () => Tick = () => 0): ICreatureQuery {
  let nextId = 1;
  const dummies = new Map<EntityId, Dummy>();

  const add = (d: Omit<Dummy, 'entityId' | 'health'> & { health?: number }): EntityId => {
    const entityId = nextId++;
    dummies.set(entityId, { ...d, entityId, health: d.health ?? d.maxHealth });
    return entityId;
  };

  // Four stationary training dummies in a square — Member 5's combat scene relies on these
  // being at predictable, unmoving positions.
  const trainingSpots: Vec3[] = [vec3(6, 0, -6), vec3(-6, 0, -6), vec3(6, 0, 6), vec3(-6, 0, 6)];
  for (const spot of trainingSpots) {
    add({
      speciesId: toSpeciesId('training_dummy'),
      tier: 'herbivore',
      maxHealth: 200,
      hostile: false,
      orbitRadius: 0,
      orbitSpeed: 0,
      orbitPhase: 0,
      fixedAt: vec3(spot.x, nullHeightAt(spot.x, spot.z), spot.z),
    });
  }

  // Plus a few moving creatures so perception, targeting, and herd rendering have live input.
  const orbiters: readonly [SpeciesId, TrophicTier, number, boolean, number, number][] = [
    [toSpeciesId('deer'), 'herbivore', 60, false, 18, 0.00042],
    [toSpeciesId('deer'), 'herbivore', 60, false, 22, 0.00037],
    [toSpeciesId('hare'), 'herbivore', 25, false, 12, 0.00090],
    [toSpeciesId('wolf'), 'predator', 120, true, 30, 0.00055],
    [toSpeciesId('wolf'), 'predator', 120, true, 34, 0.00051],
    [toSpeciesId('dire_bear'), 'apex', 600, true, 45, 0.00028],
  ];
  orbiters.forEach(([sid, tier, hp, hostile, radius, speed], i) => {
    add({
      speciesId: sid,
      tier,
      maxHealth: hp,
      hostile,
      orbitRadius: radius,
      orbitSpeed: speed,
      orbitPhase: (i / orbiters.length) * Math.PI * 2,
    });
  });

  const positionOf = (d: Dummy, tick: Tick): Vec3 => {
    if (d.fixedAt !== undefined) return d.fixedAt;
    const a = d.orbitPhase + tick * d.orbitSpeed * Math.PI * 2;
    const x = Math.cos(a) * d.orbitRadius;
    const z = Math.sin(a) * d.orbitRadius;
    return vec3(x, nullHeightAt(x, z), z);
  };

  const velocityOf = (d: Dummy, tick: Tick): Vec3 => {
    if (d.fixedAt !== undefined) return vec3();
    const a = d.orbitPhase + tick * d.orbitSpeed * Math.PI * 2;
    const tangential = d.orbitSpeed * Math.PI * 2 * d.orbitRadius * 20; // per second
    return vec3(-Math.sin(a) * tangential, 0, Math.cos(a) * tangential);
  };

  const toInfo = (d: Dummy, tick: Tick): CreatureInfo => ({
    entityId: d.entityId,
    speciesId: d.speciesId,
    pos: positionOf(d, tick),
    velocity: velocityOf(d, tick),
    health: d.health,
    maxHealth: d.maxHealth,
    tier: d.tier,
    resistances: d.tier === 'apex' ? ARMORED : RESIST,
    isHostile: d.hostile,
  });

  const matches = (d: Dummy, filter?: CreatureFilter): boolean => {
    if (filter === undefined) return true;
    if (filter.aliveOnly === true && d.health <= 0) return false;
    if (filter.hostileOnly === true && !d.hostile) return false;
    if (filter.tier !== undefined && d.tier !== filter.tier) return false;
    if (filter.species !== undefined && !filter.species.includes(d.speciesId)) return false;
    return true;
  };

  return {
    getNearby(pos, radius, filter) {
      const tick = getTick();
      const r2 = radius * radius;
      const out: CreatureInfo[] = [];
      for (const d of dummies.values()) {
        if (!matches(d, filter)) continue;
        const info = toInfo(d, tick);
        if (dist2(info.pos, pos) > r2) continue;
        out.push(info);
        if (filter?.limit !== undefined && out.length >= filter.limit) break;
      }
      return out;
    },

    getEntity(entityId) {
      const d = dummies.get(entityId);
      return d === undefined ? null : toInfo(d, getTick());
    },

    countBySpecies(speciesId) {
      let n = 0;
      for (const d of dummies.values()) if (d.speciesId === speciesId && d.health > 0) n++;
      return n;
    },

    spawn(speciesId, pos) {
      return add({
        speciesId,
        tier: 'herbivore',
        maxHealth: 100,
        hostile: false,
        orbitRadius: 0,
        orbitSpeed: 0,
        orbitPhase: 0,
        fixedAt: pos,
      });
    },

    despawn(entityId) {
      dummies.delete(entityId);
    },

    applyDamage(entityId, amount, type, isCrit) {
      const d = dummies.get(entityId);
      if (d === undefined || d.health <= 0) return 0;
      const resist = (d.tier === 'apex' ? ARMORED : RESIST)[type];
      const dealt = amount * resist * (isCrit ? 2 : 1);
      d.health = Math.max(0, d.health - dealt);
      // Training dummies never truly die — Member 5 needs a target that stays put.
      if (d.health <= 0 && d.fixedAt !== undefined) d.health = d.maxHealth;
      return dealt;
    },

    getActiveBosses() {
      const tick = getTick();
      return [...dummies.values()].filter((d) => d.tier === 'apex').map((d) => toInfo(d, tick));
    },

    getPopulationCount() {
      return dummies.size;
    },
  };
}
