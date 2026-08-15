/**
 * FROZEN — integration lead only. See CLAUDE.md § Frozen files.
 *
 * Creature and boss events. Owned by `creatures` — no other module may emit these.
 */

import type {
  BossId,
  DeathCause,
  EntityId,
  RegionId,
  SpeciesId,
  Vec3,
} from '../ids';

/**
 * A creature died. `cause` drives the ENTIRE cascade system: `'player'` is what the world
 * remembers and holds the player responsible for. Emit exactly one of these per death, always
 * with an accurate cause.
 */
export interface CreatureDied {
  type: 'creature:died';
  speciesId: SpeciesId;
  entityId: EntityId;
  cause: DeathCause;
  pos: Vec3;
  regionId: RegionId;
}

export interface CreatureBorn {
  type: 'creature:born';
  speciesId: SpeciesId;
  entityId: EntityId;
  pos: Vec3;
  regionId: RegionId;
}

/** A creature entered a distinct behavioural state. Presentation uses this for calls/VFX. */
export interface CreatureStateChanged {
  type: 'creature:stateChanged';
  entityId: EntityId;
  speciesId: SpeciesId;
  state: 'idle' | 'graze' | 'hunt' | 'flee' | 'fight' | 'drink' | 'rest' | 'migrate';
}

export interface BossPhaseChanged {
  type: 'boss:phaseChanged';
  bossId: BossId;
  entityId: EntityId;
  phase: number;
  /** 0..1 */
  healthFraction: number;
}

export interface BossDefeated {
  type: 'boss:defeated';
  bossId: BossId;
  regionId: RegionId;
  /** A boss death is a major ecological event. */
  ecologicalImpact: string;
}

export type CreatureEvent =
  | CreatureDied
  | CreatureBorn
  | CreatureStateChanged
  | BossPhaseChanged
  | BossDefeated;
