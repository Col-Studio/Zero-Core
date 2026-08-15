/**
 * FROZEN — integration lead only. See CLAUDE.md § Frozen files.
 *
 * Null world. Smooth deterministic sine-noise terrain with 6 biomes and a grid of regions.
 *
 * This is not a stub that returns zeros. Every other module develops against it for the whole
 * project, so it has to feel like a real world: walkable hills, a lake, resource nodes, named
 * regions with neighbours. If a module looks right against this, it will look right against the
 * real `world`.
 */

import type {
  BiomeSample,
  GroundHit,
  IWorldQuery,
  RegionInfo,
  ResourceNode,
  WaterSurface,
} from '../services';
import {
  regionId as toRegionId,
  resourceId as toResourceId,
  vec3,
  type BiomeKind,
  type RegionId,
  type Vec3,
} from '../ids';
import { createRng, hashString } from '../rng';

/** Region grid pitch in metres. Matches the ~200 m regions the real world will use. */
const REGION_SIZE = 200;
const REGION_GRID = 5; // 5×5 = 25 regions, centred on the origin
const WATER_LEVEL = -1.5;

const BIOME_ORDER: readonly BiomeKind[] = [
  'meadow',
  'forest',
  'alpine',
  'wetland',
  'badlands',
  'ashland',
];

const NAME_HEADS = ['Mill', 'Ash', 'Thorn', 'Grey', 'Elder', 'Fern', 'Stone', 'Wolf'];
const NAME_TAILS = ['brook', 'hollow', 'reach', 'fell', 'moor', 'vale', 'crest', 'mire'];

/** Deterministic smooth height field. Cheap, continuous, and stable across machines. */
export function nullHeightAt(x: number, z: number): number {
  return (
    18 * Math.sin(x * 0.0100) * Math.cos(z * 0.0090) +
    7 * Math.sin(x * 0.0310 + 1.7) * Math.cos(z * 0.0280 - 0.4) +
    2.5 * Math.sin(x * 0.0900 - 0.8) * Math.cos(z * 0.0850 + 2.1)
  );
}

function regionIndex(x: number, z: number): { ix: number; iz: number } {
  const half = Math.floor(REGION_GRID / 2);
  const ix = Math.min(half, Math.max(-half, Math.round(x / REGION_SIZE)));
  const iz = Math.min(half, Math.max(-half, Math.round(z / REGION_SIZE)));
  return { ix, iz };
}

const regionKey = (ix: number, iz: number): RegionId => toRegionId(`r_${ix}_${iz}`);

function buildRegions(): Map<RegionId, RegionInfo> {
  const out = new Map<RegionId, RegionInfo>();
  const half = Math.floor(REGION_GRID / 2);

  for (let iz = -half; iz <= half; iz++) {
    for (let ix = -half; ix <= half; ix++) {
      const id = regionKey(ix, iz);
      const rng = createRng(hashString(id));
      const cx = ix * REGION_SIZE;
      const cz = iz * REGION_SIZE;

      const neighbors: RegionId[] = [];
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nx = ix + dx;
        const nz = iz + dz;
        if (nx >= -half && nx <= half && nz >= -half && nz <= half) {
          neighbors.push(regionKey(nx, nz));
        }
      }

      out.set(id, {
        id,
        name: `${rng.pick(NAME_HEADS)}${rng.pick(NAME_TAILS)}`,
        biome: BIOME_ORDER[Math.abs(ix + iz * 2) % BIOME_ORDER.length]!,
        center: vec3(cx, nullHeightAt(cx, cz), cz),
        areaM2: REGION_SIZE * REGION_SIZE,
        neighbors,
      });
    }
  }
  return out;
}

function buildResourceNodes(regions: Map<RegionId, RegionInfo>): Map<RegionId, ResourceNode[]> {
  const kinds = ['ore', 'stone', 'timber', 'herb', 'game'] as const;
  const out = new Map<RegionId, ResourceNode[]>();

  for (const [id, info] of regions) {
    const rng = createRng(hashString(`nodes:${id}`));
    const nodes: ResourceNode[] = [];
    const count = rng.int(3, 7);
    for (let i = 0; i < count; i++) {
      const kind = rng.pick(kinds);
      const px = info.center.x + rng.range(-REGION_SIZE / 2, REGION_SIZE / 2);
      const pz = info.center.z + rng.range(-REGION_SIZE / 2, REGION_SIZE / 2);
      nodes.push({
        id: toResourceId(`${id}_n${i}`),
        kind,
        pos: vec3(px, nullHeightAt(px, pz), pz),
        remaining: rng.range(0.4, 1),
        renewable: kind === 'timber' || kind === 'herb' || kind === 'game',
      });
    }
    out.set(id, nodes);
  }
  return out;
}

export function createNullWorldQuery(): IWorldQuery {
  const regions = buildRegions();
  const nodes = buildResourceNodes(regions);

  // One lake near the origin, so water-dependent code has something to find.
  const lakeOutline: Vec3[] = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    lakeOutline.push(vec3(140 + Math.cos(a) * 45, WATER_LEVEL, -80 + Math.sin(a) * 38));
  }
  const water: WaterSurface[] = [
    {
      kind: 'lake',
      outline: lakeOutline,
      surfaceY: WATER_LEVEL,
      flowDir: vec3(0, 0, 0),
      regionId: regionKey(1, 0),
    },
  ];

  const biomeAt = (x: number, z: number): BiomeSample => {
    const { ix, iz } = regionIndex(x, z);
    const info = regions.get(regionKey(ix, iz))!;
    const kind = info.biome;

    // Blend with the neighbour we're closest to, so borders are soft rather than hard.
    const fx = x / REGION_SIZE - ix;
    const fz = z / REGION_SIZE - iz;
    const edge = Math.max(Math.abs(fx), Math.abs(fz)) * 2; // 0 at centre, 1 at border
    const neighborId = info.neighbors[Math.abs(fx) > Math.abs(fz) ? 0 : Math.min(2, info.neighbors.length - 1)];
    const neighborKind = neighborId !== undefined ? regions.get(neighborId)!.biome : kind;

    const primary = 1 - edge * 0.35;
    const weights: Partial<Record<BiomeKind, number>> = { [kind]: primary };
    if (neighborKind !== kind) weights[neighborKind] = 1 - primary;

    const height = nullHeightAt(x, z);
    return {
      kind,
      weights,
      moisture: 0.5 + 0.35 * Math.sin(x * 0.004 + z * 0.003),
      temperature: 0.6 - height / 120,
      baseVegetation:
        kind === 'forest' ? 0.9 : kind === 'meadow' ? 0.7 : kind === 'wetland' ? 0.6 : kind === 'alpine' ? 0.3 : 0.15,
      waterAvailability: kind === 'wetland' ? 0.95 : kind === 'badlands' || kind === 'ashland' ? 0.1 : 0.5,
    };
  };

  return {
    getHeightAt: nullHeightAt,
    getBiomeAt: biomeAt,

    getRegionIdAt(x, z) {
      const { ix, iz } = regionIndex(x, z);
      return regionKey(ix, iz);
    },

    getRegion(id) {
      return regions.get(id) ?? null;
    },

    getAllRegions() {
      return [...regions.values()];
    },

    isWalkable(x, z) {
      const h = nullHeightAt(x, z);
      if (h < WATER_LEVEL) return false;
      // Central-difference slope over 1 m; reject anything steeper than ~40°.
      const dx = nullHeightAt(x + 0.5, z) - nullHeightAt(x - 0.5, z);
      const dz = nullHeightAt(x, z + 0.5) - nullHeightAt(x, z - 0.5);
      return Math.hypot(dx, dz) < 0.84;
    },

    getResourceNodes(id) {
      return nodes.get(id) ?? [];
    },

    raycastGround(x, z): GroundHit {
      const h = nullHeightAt(x, z);
      const dx = nullHeightAt(x + 0.5, z) - nullHeightAt(x - 0.5, z);
      const dz = nullHeightAt(x, z + 0.5) - nullHeightAt(x, z - 0.5);
      const len = Math.hypot(dx, 1, dz);
      const { ix, iz } = regionIndex(x, z);
      return {
        point: vec3(x, h, z),
        normal: vec3(-dx / len, 1 / len, -dz / len),
        biome: biomeAt(x, z).kind,
        regionId: regionKey(ix, iz),
        submerged: h < WATER_LEVEL,
      };
    },

    getWaterSurfaces(id) {
      return id === undefined ? water : water.filter((w) => w.regionId === id);
    },

    findFlatSites(count, _minAreaM2) {
      const rng = createRng(hashString('flat-sites'));
      const sites: Vec3[] = [];
      let guard = 0;
      while (sites.length < count && guard++ < count * 400) {
        const x = rng.range(-450, 450);
        const z = rng.range(-450, 450);
        const h = nullHeightAt(x, z);
        if (h < WATER_LEVEL + 2) continue;
        const dx = nullHeightAt(x + 2, z) - nullHeightAt(x - 2, z);
        const dz = nullHeightAt(x, z + 2) - nullHeightAt(x, z - 2);
        if (Math.hypot(dx, dz) > 0.9) continue;
        sites.push(vec3(x, h, z));
      }
      return sites;
    },

    // Null time advances with nothing — the core loop owns time. Fixed mid-morning so
    // screenshots taken against Nulls are always identically lit.
    getDayFraction() {
      return 0.3;
    },
  };
}
