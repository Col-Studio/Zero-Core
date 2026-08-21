/**
 * Types for the nature-rules engine. Rule TABLES live in natureRules.*.data.ts (CLAUDE.md §
 * Hard invariant 9 — tuning is data, never inline in logic); this file only defines the shape.
 */

import type { SpeciesId, WeatherKind } from '@contracts/index';

export type CompareOp = '<' | '<=' | '>' | '>=' | '==';

export interface PopulationCondition {
  kind: 'population';
  species: SpeciesId;
  /** Compares the species' normalized (0..1 of capacity) stock in the rule's region. */
  op: CompareOp;
  value: number;
}

export interface VegetationCondition {
  kind: 'vegetation';
  op: CompareOp;
  value: number;
}

/** Compares the DECAYED player-pressure count for a species in the rule's region. */
export interface PlayerKillsCondition {
  kind: 'playerKills';
  species: SpeciesId;
  op: CompareOp;
  value: number;
}

/** Weather is owned by `world`; against a Null world this reads a neutral default (see facts.ts). */
export interface WeatherCondition {
  kind: 'weather';
  weather: WeatherKind;
}

/** Economic stress is owned by `society`; against a Null society this reads a neutral default. */
export interface EconomyCondition {
  kind: 'economy';
  op: CompareOp;
  /** 0..1 stress proxy — see facts.ts for how it's derived. */
  value: number;
}

export interface CompoundCondition {
  kind: 'compound';
  op: 'AND' | 'OR';
  conditions: Condition[];
}

export type Condition =
  | PopulationCondition
  | VegetationCondition
  | PlayerKillsCondition
  | WeatherCondition
  | EconomyCondition
  | CompoundCondition;

// -------------------------------------------------------------------------------------------
// Effects — restricted to what `ecology` actually owns (population numbers + vegetation).
// Economic/social/weather consequences are conveyed only through the rule's narrative text and
// severity on the emitted cascade:triggered event; `ecology` has no command to mutate villages,
// factions, or weather directly (see INTEGRATION_NOTES.md).
// -------------------------------------------------------------------------------------------

export interface PopulationRateEffect {
  kind: 'populationRate';
  species: SpeciesId;
  /** Multiplies reproductionRate for the duration. <1 suppresses, >1 boosts. */
  multiplier: number;
  durationTicks: number;
}

export interface VegetationDeltaEffect {
  kind: 'vegetationDelta';
  /** Instant additive change, applied once. */
  delta: number;
}

export interface FireEffect {
  kind: 'fire';
}

export interface MigrationEffect {
  kind: 'migration';
  species: SpeciesId;
  direction: 'in' | 'out';
  reason: 'niche-vacant' | 'overcrowding' | 'famine' | 'disaster' | 'season';
  /** Fraction of destination capacity that arrives/leaves. */
  countFraction: number;
  /** For 'in': pull from an adjacent region if possible, else spawn from nothing (re-seed). */
  fromAdjacent?: boolean;
}

export interface PopulationShockEffect {
  kind: 'populationShock';
  species: SpeciesId;
  /** Instant multiplicative change to stock, e.g. -0.4 = lose 40% now. */
  fractionDelta: number;
}

export type Effect =
  | PopulationRateEffect
  | VegetationDeltaEffect
  | FireEffect
  | MigrationEffect
  | PopulationShockEffect;

export type CascadeSeverity = 'minor' | 'notable' | 'major' | 'catastrophic';

export interface NatureRule {
  id: string;
  when: Condition;
  /** Ticks the condition must hold continuously before the rule is considered triggered. */
  sustainedFor: number;
  /** Additional delay after the sustain period before effects actually fire. */
  after: number;
  then: Effect[];
  /** Rule ids that plausibly precede this one — used to build the displayed causal chain. */
  chain?: string[];
  narrative: string;
  severity: CascadeSeverity;
  /** Species the player pressured to cause this, when attributable. */
  blamedSpecies?: SpeciesId;
  /** Fires at most once per region for the life of the session. */
  once?: boolean;
}
