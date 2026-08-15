/**
 * FROZEN — integration lead only. See CLAUDE.md § Frozen files.
 *
 * The six service interfaces. Each module implements exactly one and consumes the other five
 * through this file — never through an import of another module's folder.
 *
 * Design rules, because these are the hardest things to change later:
 *   • Queries are SYNCHRONOUS and cheap. They are called from hot loops; anything expensive
 *     must be cached behind the interface by its owner.
 *   • Queries never mutate. The two exceptions are named as commands (`applyKill`, `spawn`,
 *     `applyDamage`) and are documented as such.
 *   • Return plain serializable data, never live THREE objects or internal class instances.
 *   • Every method must have a sensible answer even when the owning module is a Null — callers
 *     are developed against Nulls for the whole project.
 */

import type {
  BiomeKind,
  BossId,
  CombatStyle,
  DamageType,
  DeathCause,
  EntityId,
  FactionId,
  MissionId,
  RegionId,
  ResourceId,
  SpeciesId,
  Tick,
  TrophicTier,
  Vec3,
  VillageId,
} from './ids';
import type { EventBus } from './bus';
import type { Rng } from './rng';

// -------------------------------------------------------------------------------------------
// Shared data shapes
// -------------------------------------------------------------------------------------------

export interface BiomeSample {
  kind: BiomeKind;
  /** Blend weights, summing to ~1. Never hard borders. */
  weights: Partial<Record<BiomeKind, number>>;
  moisture: number;
  temperature: number;
  /** 0..1 baseline vegetation this biome can support. */
  baseVegetation: number;
  waterAvailability: number;
}

export interface RegionInfo {
  id: RegionId;
  /** Generated display name, e.g. "Millbrook Hollow". Shown in missions and the chronicle. */
  name: string;
  biome: BiomeKind;
  center: Vec3;
  areaM2: number;
  neighbors: readonly RegionId[];
}

export interface ResourceNode {
  id: ResourceId;
  kind: 'ore' | 'stone' | 'timber' | 'herb' | 'game';
  pos: Vec3;
  /** 0..1 remaining. 0 = depleted, regrows for renewables. */
  remaining: number;
  renewable: boolean;
}

export interface WaterSurface {
  kind: 'lake' | 'river' | 'sea';
  /** World-space outline, CCW. Presentation builds its water mesh from this. */
  outline: readonly Vec3[];
  surfaceY: number;
  flowDir: Vec3;
  regionId: RegionId;
}

export interface GroundHit {
  point: Vec3;
  /** Surface normal — used for slope checks and foot placement. */
  normal: Vec3;
  biome: BiomeKind;
  regionId: RegionId;
  /** True when the point is under a water surface. */
  submerged: boolean;
}

/** Population state for one species in one region. */
export interface PopulationState {
  speciesId: SpeciesId;
  regionId: RegionId;
  /** Continuous stock — floats, because integer populations quantise cascades into steps. */
  stock: number;
  /** 0..1 of carrying capacity. */
  normalized: number;
  carryingCapacity: number;
  /** Signed per-1000-tick trend, for graphs and "is this collapsing?" checks. */
  trend: number;
}

export interface TrophicState {
  regionId: RegionId;
  /** Total biomass per tier — the shape of the food web right now. */
  byTier: Record<TrophicTier, number>;
  vegetation: number;
  /** 0..1 composite health. 0 = dead region. Presentation grades colour/audio from this. */
  health: number;
  /** Species present with a non-trivial population. */
  present: readonly SpeciesId[];
}

/** How much the player has pressured a species — the world's memory of them. */
export interface PressureRecord {
  speciesId: SpeciesId;
  /** Player kills, all regions, with slow decay. */
  totalKills: number;
  killsByRegion: Readonly<Record<string, number>>;
  /** 0..1 normalised pressure. 1 = relentlessly hunted. */
  pressure: number;
  lastKillTick: Tick;
}

export interface CreatureInfo {
  entityId: EntityId;
  speciesId: SpeciesId;
  pos: Vec3;
  velocity: Vec3;
  health: number;
  maxHealth: number;
  /** Present only for bosses. */
  bossId?: BossId;
  tier: TrophicTier;
  /** Resistance multipliers per damage type; 1 = normal. */
  resistances: Readonly<Record<DamageType, number>>;
  isHostile: boolean;
}

export interface CreatureFilter {
  species?: readonly SpeciesId[];
  tier?: TrophicTier;
  hostileOnly?: boolean;
  aliveOnly?: boolean;
  /** Cap the result length — callers in hot loops should always set this. */
  limit?: number;
}

export interface VillageInfo {
  id: VillageId;
  name: string;
  pos: Vec3;
  regionId: RegionId;
  population: number;
  factionId: FactionId;
  state: 'thriving' | 'stable' | 'strained' | 'starving' | 'collapsing' | 'abandoned';
}

export interface EconomyState {
  villageId: VillageId;
  /** Stock levels, 0..1 of desired reserve. */
  stocks: Record<'food' | 'timber' | 'ore' | 'hides' | 'coin', number>;
  /** Net per-day flow per commodity; negative means draining. */
  flows: Record<'food' | 'timber' | 'ore' | 'hides' | 'coin', number>;
  /** Current dominant industry — villages switch these to survive. */
  industry: 'farming' | 'hunting' | 'logging' | 'mining' | 'trade' | 'none';
  /** Plain-language ecological explanation of the current state. */
  reason: string;
}

export interface MissionInfo {
  id: MissionId;
  title: string;
  summary: string;
  villageId: VillageId;
  factionId: FactionId;
  rank: number;
  state: 'offered' | 'active' | 'completed' | 'failed';
  objectives: readonly {
    text: string;
    done: boolean;
    progress: number;
    target: number;
  }[];
  /** Ticks remaining, or null when untimed. */
  expiresIn: number | null;
}

export type PlayerStance = 'idle' | 'walk' | 'sprint' | 'crouch' | 'jump' | 'swim' | 'attack';

// -------------------------------------------------------------------------------------------
// The six interfaces
// -------------------------------------------------------------------------------------------

/** Implemented by `world`. The single source of truth for "what is at this point in space". */
export interface IWorldQuery {
  getHeightAt(x: number, z: number): number;
  getBiomeAt(x: number, z: number): BiomeSample;
  getRegionIdAt(x: number, z: number): RegionId;
  getRegion(id: RegionId): RegionInfo | null;
  getAllRegions(): readonly RegionInfo[];
  /** Slope- and water-aware. Called every tick by creature and NPC pathing — keep it fast. */
  isWalkable(x: number, z: number): boolean;
  getResourceNodes(regionId: RegionId): readonly ResourceNode[];
  raycastGround(x: number, z: number): GroundHit;
  getWaterSurfaces(regionId?: RegionId): readonly WaterSurface[];
  /** Flat, dry, gently sloped spots suitable for a settlement. Used by `society`. */
  findFlatSites(count: number, minAreaM2: number): readonly Vec3[];
  /** Current sim time-of-day, 0..1. Presentation drives the sun from this. */
  getDayFraction(): number;
}

/** Implemented by `ecology`. Owns all population NUMBERS; owns no bodies. */
export interface IEcologyQuery {
  getPopulation(speciesId: SpeciesId, regionId: RegionId): PopulationState;
  getAllPopulations(regionId: RegionId): readonly PopulationState[];
  getVegetation(regionId: RegionId): number;
  getTrophicState(regionId: RegionId): TrophicState;
  /** The world's memory of the player, per species. */
  getPressure(speciesId: SpeciesId): PressureRecord;
  /**
   * COMMAND. Register a death against the ecological model. `creatures` calls this (or emits
   * `creature:died`, which `ecology` also listens for) — do not call it twice for one death.
   */
  applyKill(speciesId: SpeciesId, regionId: RegionId, cause: DeathCause): void;
  /** Rule ids that have fired, newest first. Powers the chronicle. */
  getRecentCascades(limit: number): readonly {
    ruleId: string;
    tick: Tick;
    narrative: string;
    chain: readonly string[];
    regionId: RegionId;
  }[];
  /** Every species in the trophic web, for UI and validation. */
  getSpeciesList(): readonly {
    id: SpeciesId;
    name: string;
    tier: TrophicTier;
    diet: readonly SpeciesId[];
    predators: readonly SpeciesId[];
  }[];
}

/** Implemented by `creatures`. Owns bodies; owns no population numbers. */
export interface ICreatureQuery {
  /** Spatial query. Always pass `filter.limit` from hot code. */
  getNearby(pos: Vec3, radius: number, filter?: CreatureFilter): readonly CreatureInfo[];
  getEntity(entityId: EntityId): CreatureInfo | null;
  countBySpecies(speciesId: SpeciesId, regionId?: RegionId): number;
  /** COMMAND. Spawn a body. Usually driven by `species:migrating` from `ecology`. */
  spawn(speciesId: SpeciesId, pos: Vec3): EntityId;
  /** COMMAND. Remove a body without emitting a death. Use for culling, not for kills. */
  despawn(entityId: EntityId): void;
  /** COMMAND. Apply damage from the player. Returns damage actually dealt after resistances. */
  applyDamage(entityId: EntityId, amount: number, type: DamageType, isCrit: boolean): number;
  /** Live boss entities, for HUD health bars and mission tracking. */
  getActiveBosses(): readonly CreatureInfo[];
  /** Total live bodies — perf dashboards read this. */
  getPopulationCount(): number;
}

/** Implemented by `player`. */
export interface IPlayerQuery {
  getPosition(): Vec3;
  getVelocity(): Vec3;
  getStance(): PlayerStance;
  getHealth(): { current: number; max: number };
  getStamina(): { current: number; max: number };
  getStyle(): CombatStyle;
  isInCombat(): boolean;
  getRegionId(): RegionId | null;
  /** COMMAND. Bosses and hazards call this. */
  applyDamage(amount: number, source: 'creature' | 'boss' | 'fall' | 'drown' | 'environment'): void;
  /** Inventory count for a resource — `society` checks this for mission turn-ins. */
  getInventoryCount(resourceId: ResourceId): number;
}

/** Implemented by `society`. */
export interface ISocietyQuery {
  getVillage(id: VillageId): VillageInfo | null;
  getAllVillages(): readonly VillageInfo[];
  getVillagesNear(pos: Vec3, radius: number): readonly VillageInfo[];
  getEconomy(villageId: VillageId): EconomyState | null;
  getActiveMissions(): readonly MissionInfo[];
  getOfferedMissions(villageId?: VillageId): readonly MissionInfo[];
  getMission(id: MissionId): MissionInfo | null;
  /** -1..1, where -1 is hostile. */
  getFactionRelation(a: FactionId, b: FactionId | 'player'): number;
  getFactionList(): readonly { id: FactionId; name: string; standing: number }[];
  /** The world's story so far, newest first. `presentation` renders this. */
  getChronicle(limit: number): readonly {
    tick: Tick;
    title: string;
    body: string;
    severity: 'minor' | 'notable' | 'major' | 'catastrophic';
  }[];
  /** COMMAND. Player accepted a mission. */
  acceptMission(id: MissionId): boolean;
}

/** Implemented by `presentation`. Fire-and-forget: must never throw on unknown input. */
export interface IPresentation {
  requestVfx(
    kind: string,
    pos: Vec3,
    opts?: { intensity?: number; color?: string; dir?: Vec3 },
  ): void;
  requestSfx(kind: string, pos?: Vec3, opts?: { volume?: number }): void;
  setWeatherVisual(kind: string, intensity: number): void;
  showToast(text: string, tone?: 'info' | 'warn' | 'danger' | 'discovery'): void;
  /** Camera shake — combat feel. Magnitude in metres, duration in ticks. */
  shakeCamera(magnitude: number, durationTicks: number): void;
  /** Freeze frames on impact. `player` drives hitstop through this. */
  requestHitstop(durationTicks: number): void;
}

// -------------------------------------------------------------------------------------------
// Mount context — what every module receives
// -------------------------------------------------------------------------------------------

/**
 * Handed to every `mountX(ctx)`. Modules must resolve services through `ctx.services` at CALL
 * time rather than caching them at mount time, because the integration lead swaps Nulls for
 * real implementations one at a time after the merge.
 */
export interface MountContext {
  /** Session seed. Fork your own sub-stream: `ctx.rng.fork('world')`. */
  seed: number;
  rng: Rng;
  bus: EventBus;
  services: ServiceRegistryLike;
  /** Current simulation tick. Read it; never advance it. */
  getTick(): Tick;
  /** Active debug scene from `?scene=`, or null in the full game. */
  debugScene: string | null;
  /** `?freeze=1` — pin camera and time so screenshots are comparable. */
  frozen: boolean;
}

/** Structural type so `services.ts` doesn't have to import `registry.ts` (avoids a cycle). */
export interface ServiceRegistryLike {
  world(): IWorldQuery;
  ecology(): IEcologyQuery;
  creatures(): ICreatureQuery;
  player(): IPlayerQuery;
  society(): ISocietyQuery;
  presentation(): IPresentation;
}

/** The one entry point each module exports from its `index.ts`. */
export type MountFn = (ctx: MountContext) => void | (() => void);
