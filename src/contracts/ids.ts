/**
 * FROZEN — integration lead only. See CLAUDE.md § Frozen files.
 *
 * Branded id types. These are strings at runtime and distinct types at compile time, so
 * `getVillage(regionId)` is a type error instead of a silent bug that surfaces three modules
 * away. Branding is the cheapest defence we have against seven isolated agents disagreeing
 * about what a string means.
 */

declare const brand: unique symbol;

/** A nominal string type. `Branded<'Species'>` is not assignable to `Branded<'Region'>`. */
type Branded<TBrand extends string> = string & { readonly [brand]: TBrand };

export type SpeciesId = Branded<'Species'>;
export type RegionId = Branded<'Region'>;
export type VillageId = Branded<'Village'>;
export type MissionId = Branded<'Mission'>;
export type FactionId = Branded<'Faction'>;
export type BossId = Branded<'Boss'>;
export type ResourceId = Branded<'Resource'>;

/** Entities are numeric — they live in hot loops and typed arrays, so no branding. */
export type EntityId = number;

/** Sentinel for "no entity". Never a valid entity id. */
export const NO_ENTITY: EntityId = -1;

// -------------------------------------------------------------------------------------------
// Constructors. Cheap casts, but they document intent and give us one place to add validation.
// -------------------------------------------------------------------------------------------

export const speciesId = (raw: string): SpeciesId => raw as SpeciesId;
export const regionId = (raw: string): RegionId => raw as RegionId;
export const villageId = (raw: string): VillageId => raw as VillageId;
export const missionId = (raw: string): MissionId => raw as MissionId;
export const factionId = (raw: string): FactionId => raw as FactionId;
export const bossId = (raw: string): BossId => raw as BossId;
export const resourceId = (raw: string): ResourceId => raw as ResourceId;

// -------------------------------------------------------------------------------------------
// Shared geometry. Plain objects, not THREE.Vector3 — contracts must stay importable from
// headless Vitest tests with no renderer and no WebGL context.
// -------------------------------------------------------------------------------------------

/** World-space position. 1 unit = 1 metre, Y-up, right-handed. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const vec3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });

/** Squared distance. Prefer this in comparisons — no sqrt in hot loops. */
export function dist2(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

export const dist = (a: Vec3, b: Vec3): number => Math.sqrt(dist2(a, b));

/** Horizontal-only squared distance. Most gameplay queries ignore height. */
export function dist2XZ(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

// -------------------------------------------------------------------------------------------
// Simulation vocabulary shared by several modules.
// -------------------------------------------------------------------------------------------

/** Simulation tick count. 20 ticks = 1 simulated second. Never use wall-clock in sim code. */
export type Tick = number;

/** Ticks per simulated second. The fixed timestep is 1/20 s. */
export const TICKS_PER_SECOND = 20;
export const FIXED_DT = 1 / TICKS_PER_SECOND;

export const secondsToTicks = (s: number): Tick => Math.round(s * TICKS_PER_SECOND);
export const ticksToSeconds = (t: Tick): number => t / TICKS_PER_SECOND;
export const minutesToTicks = (m: number): Tick => secondsToTicks(m * 60);

/** Why a creature died. Member 3's entire cascade system branches on this. */
export type DeathCause = 'player' | 'predator' | 'starvation' | 'age' | 'disease' | 'disaster';

/** Coarse biome kinds. `world` owns the real definitions and blend weights. */
export type BiomeKind = 'meadow' | 'forest' | 'alpine' | 'wetland' | 'badlands' | 'ashland';

export type WeatherKind = 'clear' | 'overcast' | 'rain' | 'storm' | 'snow' | 'fog' | 'dust';

export type DayPhase = 'dawn' | 'day' | 'dusk' | 'night';

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

/** The four fighting styles. `player` owns the timing data; others only branch on the name. */
export type CombatStyle = 'blade' | 'heavy' | 'hunter' | 'beast';

export type DamageType = 'slash' | 'blunt' | 'pierce';

/** Trophic tier, apex-first. Used by the nature-rules engine and the chronicle UI. */
export type TrophicTier = 'apex' | 'predator' | 'herbivore' | 'producer';
