/**
 * FROZEN — integration lead only. See CLAUDE.md § Frozen files.
 *
 * Player events (owned by `player`) and presentation requests (emitted by everyone, consumed
 * by `presentation`).
 */

import type {
  CombatStyle,
  DamageType,
  EntityId,
  RegionId,
  ResourceId,
  Vec3,
  VillageId,
} from '../ids';

/**
 * Emitted on EVERY landed hit. `creatures` applies the damage; `ecology` attributes the
 * resulting kill to the player. A missing emit means the world forgets what the player did,
 * which breaks the game's premise — never skip it.
 */
export interface PlayerAttacked {
  type: 'player:attacked';
  targetId: EntityId;
  damage: number;
  style: CombatStyle;
  damageType: DamageType;
  isCrit: boolean;
  pos: Vec3;
}

export interface PlayerDamaged {
  type: 'player:damaged';
  amount: number;
  source: 'creature' | 'boss' | 'fall' | 'drown' | 'environment';
  sourceId?: EntityId;
  healthRemaining: number;
}

export interface PlayerDied {
  type: 'player:died';
  /** The world does NOT reset on death. */
  respawnVillage: VillageId | null;
}

export interface PlayerStyleChanged {
  type: 'player:styleChanged';
  style: CombatStyle;
}

export interface PlayerRegionChanged {
  type: 'player:regionChanged';
  from: RegionId | null;
  to: RegionId;
}

export interface PlayerHarvested {
  type: 'player:harvested';
  resourceId: ResourceId;
  regionId: RegionId;
  amount: number;
}

export interface VfxRequest {
  type: 'vfx:request';
  kind: string;
  pos: Vec3;
  intensity?: number;
  color?: string;
  dir?: Vec3;
}

export interface SfxRequest {
  type: 'sfx:request';
  kind: string;
  pos?: Vec3;
  volume?: number;
}

export interface ToastRequest {
  type: 'ui:toast';
  text: string;
  tone: 'info' | 'warn' | 'danger' | 'discovery';
}

export type PlayerEvent =
  | PlayerAttacked
  | PlayerDamaged
  | PlayerDied
  | PlayerStyleChanged
  | PlayerRegionChanged
  | PlayerHarvested;

export type PresentationEvent = VfxRequest | SfxRequest | ToastRequest;
