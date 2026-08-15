/**
 * FROZEN — integration lead only. See CLAUDE.md § Frozen files.
 *
 * World events: terrain, resources, weather, time. Owned by `world`.
 */

import type {
  BiomeKind,
  DayPhase,
  RegionId,
  ResourceId,
  Season,
  WeatherKind,
} from '../ids';

export interface ResourceDepleted {
  type: 'resource:depleted';
  regionId: RegionId;
  resourceId: ResourceId;
  kind: 'ore' | 'stone' | 'timber' | 'herb' | 'game';
}

export interface ResourceRestored {
  type: 'resource:restored';
  regionId: RegionId;
  resourceId: ResourceId;
}

export interface WeatherChanged {
  type: 'weather:changed';
  kind: WeatherKind;
  /** 0..1 */
  intensity: number;
  /** Ticks until the next change, so presentation can plan a blend. */
  durationTicks: number;
  regionId: RegionId | null;
}

export interface TimePhase {
  type: 'time:phase';
  phase: DayPhase;
  dayCount: number;
  season: Season;
  /** 0..1 through the full day, for sun position. */
  dayFraction: number;
}

/** A region became ecologically distinct enough to re-render. Also used for the minimap. */
export interface RegionDiscovered {
  type: 'region:discovered';
  regionId: RegionId;
  name: string;
  biome: BiomeKind;
}

export type WorldEvent =
  | ResourceDepleted
  | ResourceRestored
  | WeatherChanged
  | TimePhase
  | RegionDiscovered;
