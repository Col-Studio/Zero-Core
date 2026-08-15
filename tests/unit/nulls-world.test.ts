/**
 * The Nulls are the reason seven isolated agents never block each other. Six modules develop
 * against them for the entire project, so these tests assert the properties those modules will
 * assume: determinism, plausibility, and never returning nonsense.
 *
 * A Null that returns zeros everywhere would compile and pass a naive test while making six
 * people's work look broken. That's the failure these tests exist to prevent.
 *
 * This file covers the terrain and ecosystem halves; see `nulls-actors.test.ts` for the rest.
 */

import { describe, expect, it } from 'vitest';
import { createNullEcologyQuery, createNullWorldQuery, NULL_SPECIES } from '@contracts/nulls';
import { hashState } from '@contracts/rng';
import { regionId, speciesId, type Tick } from '@contracts/ids';

describe('NullWorldQuery', () => {
  const world = createNullWorldQuery();

  it('is deterministic across instances', () => {
    const other = createNullWorldQuery();
    for (const [x, z] of [[0, 0], [123.5, -47.25], [-400, 400]] as const) {
      expect(world.getHeightAt(x, z)).toBe(other.getHeightAt(x, z));
      expect(world.getRegionIdAt(x, z)).toBe(other.getRegionIdAt(x, z));
    }
    expect(hashState(world.getAllRegions())).toBe(hashState(other.getAllRegions()));
  });

  it('produces varied, finite terrain rather than a flat plane', () => {
    const heights: number[] = [];
    for (let x = -400; x <= 400; x += 25) {
      for (let z = -400; z <= 400; z += 25) {
        const h = world.getHeightAt(x, z);
        expect(Number.isFinite(h)).toBe(true);
        heights.push(h);
      }
    }
    // Real relief — modules need slopes, peaks, and valleys to test against.
    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(20);
    expect(new Set(heights.map((h) => Math.round(h))).size).toBeGreaterThan(10);
  });

  it('is continuous — no cliffs between adjacent samples', () => {
    for (let x = -200; x < 200; x += 7) {
      const delta = Math.abs(world.getHeightAt(x, 30) - world.getHeightAt(x + 0.5, 30));
      expect(delta).toBeLessThan(2);
    }
  });

  it('returns a region for every point, and every neighbour link resolves', () => {
    const regions = world.getAllRegions();
    expect(regions.length).toBeGreaterThanOrEqual(9);

    for (const region of regions) {
      expect(region.name.length).toBeGreaterThan(3);
      expect(region.neighbors.length).toBeGreaterThanOrEqual(2);
      // `ecology` walks this graph to spread cascades — a dangling link would crash it.
      for (const neighbor of region.neighbors) {
        expect(world.getRegion(neighbor)).not.toBeNull();
      }
    }
  });

  it('reports a mix of walkable and unwalkable ground', () => {
    let walkable = 0;
    let blocked = 0;
    for (let x = -300; x <= 300; x += 20) {
      for (let z = -300; z <= 300; z += 20) {
        if (world.isWalkable(x, z)) walkable++;
        else blocked++;
      }
    }
    // Mostly walkable, but with real obstacles — pathfinding needs both.
    expect(walkable).toBeGreaterThan(blocked);
    expect(blocked).toBeGreaterThan(0);
  });

  it('returns normalized, never-inverted ground normals', () => {
    for (const [x, z] of [[0, 0], [55, -120], [-233, 88]] as const) {
      const hit = world.raycastGround(x, z);
      expect(Math.hypot(hit.normal.x, hit.normal.y, hit.normal.z)).toBeCloseTo(1, 5);
      expect(hit.normal.y).toBeGreaterThan(0);
      expect(hit.point.y).toBe(world.getHeightAt(x, z));
    }
  });

  it('provides grounded resource nodes in every region', () => {
    for (const region of world.getAllRegions()) {
      const nodes = world.getResourceNodes(region.id);
      expect(nodes.length).toBeGreaterThan(0);
      for (const node of nodes) {
        expect(node.remaining).toBeGreaterThan(0);
        expect(node.remaining).toBeLessThanOrEqual(1);
        expect(node.pos.y).toBeCloseTo(world.getHeightAt(node.pos.x, node.pos.z), 5);
      }
    }
  });

  it('provides at least one water surface for presentation to render', () => {
    const water = world.getWaterSurfaces();
    expect(water.length).toBeGreaterThan(0);
    expect(water[0]!.outline.length).toBeGreaterThan(2);
  });

  it('finds flat, dry, walkable village sites for society', () => {
    const sites = world.findFlatSites(5, 400);
    expect(sites).toHaveLength(5);
    for (const site of sites) {
      expect(site.y).toBeGreaterThan(0);
      expect(world.isWalkable(site.x, site.z)).toBe(true);
    }
  });

  it('blends biome weights instead of hard-switching', () => {
    const sample = world.getBiomeAt(95, 10); // near a region border
    const total = Object.values(sample.weights).reduce((a, b) => a + (b ?? 0), 0);
    expect(total).toBeCloseTo(1, 3);
    expect(sample.baseVegetation).toBeGreaterThan(0);
  });

  it('holds the day fixed so Null-backed screenshots are identically lit', () => {
    expect(world.getDayFraction()).toBe(createNullWorldQuery().getDayFraction());
  });
});

describe('NullEcologyQuery', () => {
  const REGION = regionId('r_0_0');
  const WOLF = speciesId('wolf');
  const DEER = speciesId('deer');

  it('is deterministic for a given tick', () => {
    const tick: Tick = 5000;
    const a = createNullEcologyQuery(() => tick);
    const b = createNullEcologyQuery(() => tick);
    expect(hashState(a.getAllPopulations(REGION))).toBe(hashState(b.getAllPopulations(REGION)));
  });

  it('drifts over time — populations must look alive, not frozen', () => {
    let tick: Tick = 0;
    const ecology = createNullEcologyQuery(() => tick);
    const samples: string[] = [];
    for (tick = 0; tick <= 24_000; tick += 2000) {
      samples.push(ecology.getPopulation(DEER, REGION).normalized.toFixed(3));
    }
    expect(new Set(samples).size).toBeGreaterThan(4);
  });

  it('never collapses or explodes — consumers must never see an empty world', () => {
    let tick: Tick = 0;
    const ecology = createNullEcologyQuery(() => tick);
    for (tick = 0; tick <= 200_000; tick += 500) {
      for (const species of NULL_SPECIES) {
        const pop = ecology.getPopulation(species.id, REGION);
        expect(pop.normalized).toBeGreaterThan(0);
        expect(pop.normalized).toBeLessThanOrEqual(1);
        expect(pop.stock).toBeGreaterThan(0);
      }
    }
  });

  it('remembers player kills — the premise of the whole game', () => {
    const ecology = createNullEcologyQuery(() => 1000);
    const before = ecology.getPopulation(WOLF, REGION).normalized;

    for (let i = 0; i < 12; i++) ecology.applyKill(WOLF, REGION, 'player');
    expect(ecology.getPopulation(WOLF, REGION).normalized).toBeLessThan(before);

    const pressure = ecology.getPressure(WOLF);
    expect(pressure.totalKills).toBe(12);
    expect(pressure.pressure).toBeGreaterThan(0);
    expect(pressure.killsByRegion[REGION]).toBe(12);
  });

  it('ignores natural deaths in the pressure ledger', () => {
    const ecology = createNullEcologyQuery(() => 1000);
    ecology.applyKill(WOLF, REGION, 'starvation');
    ecology.applyKill(WOLF, REGION, 'age');
    ecology.applyKill(WOLF, REGION, 'predator');
    expect(ecology.getPressure(WOLF).totalKills).toBe(0);
  });

  it('exposes a fully connected trophic web', () => {
    const ecology = createNullEcologyQuery();
    const list = ecology.getSpeciesList();
    const ids = new Set(list.map((s) => s.id));
    expect(list.length).toBeGreaterThanOrEqual(6);

    for (const species of list) {
      // `ecology` and `creatures` both walk these links; a dangling id breaks both.
      for (const prey of species.diet) expect(ids).toContain(prey);
      for (const predator of species.predators) expect(ids).toContain(predator);
    }
    expect(list.some((s) => s.tier === 'apex')).toBe(true);
    expect(list.some((s) => s.tier === 'producer')).toBe(true);
  });

  it('reports trophic health in 0..1 with vegetation present', () => {
    const state = createNullEcologyQuery(() => 3000).getTrophicState(REGION);
    expect(state.health).toBeGreaterThan(0);
    expect(state.health).toBeLessThanOrEqual(1);
    expect(state.vegetation).toBeGreaterThan(0);
    expect(state.present.length).toBeGreaterThan(0);
  });

  it('returns an empty cascade list — consumers must handle no history', () => {
    expect(createNullEcologyQuery().getRecentCascades(10)).toEqual([]);
  });
});
