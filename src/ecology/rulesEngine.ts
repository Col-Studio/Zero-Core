/**
 * Evaluates the rule table against one region's facts, each tick. Owns the sustained-for/after
 * timing that turns a raw condition into a delayed, narrated effect (card point 3) — this is the
 * mechanism that makes the world feel like it's *reacting* rather than switching a value.
 *
 * Runtime state (`RuleRuntimeState`) is plain serializable data on purpose: `sim.ts` persists it
 * as part of `SimState`, which is how save/load preserves a pending delayed effect mid-cascade.
 */

import type { RegionId, SpeciesId, Tick, WeatherKind } from '@contracts/index';
import type { CascadeSeverity, Condition, Effect, NatureRule } from './rules.types';

export interface RegionFacts {
  regionId: RegionId;
  /** speciesId -> normalized (0..1 of capacity) stock in this region, this tick. */
  populationNormalized: Readonly<Record<string, number>>;
  vegetation: number;
  /** speciesId -> decayed player-pressure weight, scoped to this region. */
  playerKillsDecayed: Readonly<Record<string, number>>;
  weather: WeatherKind;
  /** 0..1 proxy for village stress; neutral 0.5 until `society` is merged (see facts builder). */
  economyStress: number;
}

export interface RuleRuntimeCell {
  conditionSinceTick: Tick | null;
  pendingEffectTick: Tick | null;
  everFired: boolean;
}

/** Keyed `${ruleId}|${regionId}`. */
export type RuleRuntimeState = Map<string, RuleRuntimeCell>;

export function createRuleRuntimeState(): RuleRuntimeState {
  return new Map();
}

export interface FiredCascade {
  ruleId: string;
  regionId: RegionId;
  chain: string[];
  narrative: string;
  severity: CascadeSeverity;
  blamedSpecies?: SpeciesId;
  effects: readonly Effect[];
}

function compare(a: number, op: '<' | '<=' | '>' | '>=' | '==', b: number): boolean {
  switch (op) {
    case '<':
      return a < b;
    case '<=':
      return a <= b;
    case '>':
      return a > b;
    case '>=':
      return a >= b;
    case '==':
      return a === b;
    default:
      return false;
  }
}

export function evaluateCondition(cond: Condition, facts: RegionFacts): boolean {
  switch (cond.kind) {
    case 'population':
      return compare(facts.populationNormalized[cond.species] ?? 0, cond.op, cond.value);
    case 'vegetation':
      return compare(facts.vegetation, cond.op, cond.value);
    case 'playerKills':
      return compare(facts.playerKillsDecayed[cond.species] ?? 0, cond.op, cond.value);
    case 'weather':
      return facts.weather === cond.weather;
    case 'economy':
      return compare(facts.economyStress, cond.op, cond.value);
    case 'compound':
      return cond.op === 'AND'
        ? cond.conditions.every((c) => evaluateCondition(c, facts))
        : cond.conditions.some((c) => evaluateCondition(c, facts));
    default:
      return false;
  }
}

const key = (ruleId: string, regionId: RegionId): string => `${ruleId}|${regionId}`;

/**
 * Advance every rule's sustain/delay timer for one region by one tick, firing any that are due.
 * `recentFired` supplies rule ids that fired recently in this region (any window the caller
 * likes — sim.ts uses the last few thousand ticks), used only to build the displayed `chain`.
 */
export function stepRulesForRegion(
  rules: readonly NatureRule[],
  runtime: RuleRuntimeState,
  facts: RegionFacts,
  tick: Tick,
  recentFired: readonly string[],
): FiredCascade[] {
  const fired: FiredCascade[] = [];

  for (const rule of rules) {
    const k = key(rule.id, facts.regionId);
    let cell = runtime.get(k);
    if (cell === undefined) {
      cell = { conditionSinceTick: null, pendingEffectTick: null, everFired: false };
      runtime.set(k, cell);
    }
    if (rule.once === true && cell.everFired) continue;

    if (evaluateCondition(rule.when, facts)) {
      if (cell.conditionSinceTick === null) cell.conditionSinceTick = tick;
      const sustained = tick - cell.conditionSinceTick;
      if (sustained >= rule.sustainedFor && cell.pendingEffectTick === null) {
        cell.pendingEffectTick = tick + rule.after;
      }
    } else {
      cell.conditionSinceTick = null;
      cell.pendingEffectTick = null;
    }

    if (cell.pendingEffectTick !== null && tick >= cell.pendingEffectTick) {
      cell.everFired = true;
      cell.pendingEffectTick = null;
      cell.conditionSinceTick = null;

      const declaredChain = rule.chain ?? [];
      const chain = declaredChain.filter((id) => recentFired.includes(id));
      fired.push({
        ruleId: rule.id,
        regionId: facts.regionId,
        chain: [...chain, rule.id],
        narrative: rule.narrative,
        severity: rule.severity,
        blamedSpecies: rule.blamedSpecies,
        effects: rule.then,
      });
    }
  }

  return fired;
}

/**
 * True if a rule's condition and effects only reference species that actually exist. Used by the
 * reachability test as a shape/reference sanity check — not a full constraint solver.
 */
export function ruleReferencesKnownSpecies(rule: NatureRule, knownSpecies: ReadonlySet<SpeciesId>): boolean {
  const check = (c: Condition): boolean => {
    if (c.kind === 'compound') return c.conditions.every(check);
    if (c.kind === 'population' || c.kind === 'playerKills') return knownSpecies.has(c.species);
    return true;
  };
  if (!check(rule.when)) return false;
  for (const effect of rule.then) {
    if ('species' in effect && !knownSpecies.has(effect.species)) return false;
  }
  return true;
}
