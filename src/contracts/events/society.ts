/**
 * FROZEN — integration lead only. See CLAUDE.md § Frozen files.
 *
 * Society events: villages, factions, missions. Owned by `society`.
 */

import type { FactionId, MissionId, VillageId } from '../ids';

export interface VillageEconomyChanged {
  type: 'village:economyChanged';
  villageId: VillageId;
  state: 'thriving' | 'stable' | 'strained' | 'starving' | 'collapsing' | 'abandoned';
  /** Human-readable ecological cause. Shown to the player — this is how they learn the rules. */
  reason: string;
  /** Rule ids from `ecology` that contributed, when known. */
  causedBy?: string[];
}

export interface VillageNeedChanged {
  type: 'village:needChanged';
  villageId: VillageId;
  need: 'food' | 'timber' | 'ore' | 'hides' | 'safety' | 'medicine';
  /** 0..1, where 1 is desperate. */
  severity: number;
}

export interface FactionRelationChanged {
  type: 'faction:relationChanged';
  a: FactionId;
  b: FactionId | 'player';
  delta: number;
  value: number;
  reason: string;
}

export interface MissionOffered {
  type: 'mission:offered';
  missionId: MissionId;
  villageId: VillageId;
  factionId: FactionId;
  title: string;
  summary: string;
  rank: number;
}

export interface MissionAccepted {
  type: 'mission:accepted';
  missionId: MissionId;
}

export interface MissionCompleted {
  type: 'mission:completed';
  missionId: MissionId;
  /** Consequences the player may not have intended. Feeds the chronicle. */
  sideEffects: string[];
}

export interface MissionFailed {
  type: 'mission:failed';
  missionId: MissionId;
  reason: 'timeout' | 'target-lost' | 'village-abandoned' | 'player-death' | 'abandoned';
}

export type SocietyEvent =
  | VillageEconomyChanged
  | VillageNeedChanged
  | FactionRelationChanged
  | MissionOffered
  | MissionAccepted
  | MissionCompleted
  | MissionFailed;
