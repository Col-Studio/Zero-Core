import { describe, expect, it } from 'vitest';
import { regionId, type Tick } from '@contracts/index';
import { createRuleRuntimeState, stepRulesForRegion, type RegionFacts } from '../../src/ecology/rulesEngine';
import { ALL_RULES } from '../../src/ecology/natureRules.data';
import type { Condition } from '../../src/ecology/rules.types';

const REGION = regionId('reach_test');

function baseFacts(): RegionFacts {
  return { regionId: REGION, populationNormalized: {}, vegetation: 0.5, playerKillsDecayed: {}, weather: 'clear', economyStress: 0.5 };
}

/** Mutates `facts` so `cond` evaluates true. For OR, only the first branch is satisfied. */
function satisfy(cond: Condition, facts: RegionFacts): void {
  const nudge = (op: string, value: number): number => {
    switch (op) {
      case '<':
        return Math.max(0, value - 0.05);
      case '<=':
      case '==':
        return value;
      case '>':
        return value + 0.05;
      case '>=':
        return value;
      default:
        return value;
    }
  };

  switch (cond.kind) {
    case 'population':
      (facts.populationNormalized as Record<string, number>)[cond.species] = nudge(cond.op, cond.value);
      return;
    case 'vegetation':
      facts.vegetation = nudge(cond.op, cond.value);
      return;
    case 'playerKills':
      (facts.playerKillsDecayed as Record<string, number>)[cond.species] = nudge(cond.op, cond.value);
      return;
    case 'weather':
      facts.weather = cond.weather;
      return;
    case 'economy':
      facts.economyStress = nudge(cond.op, cond.value);
      return;
    case 'compound':
      if (cond.op === 'AND') {
        for (const c of cond.conditions) satisfy(c, facts);
      } else {
        satisfy(cond.conditions[0]!, facts);
      }
      return;
  }
}

describe('every nature rule is reachable', () => {
  for (const rule of ALL_RULES) {
    it(`'${rule.id}' can fire when its condition is satisfied`, () => {
      const facts = baseFacts();
      satisfy(rule.when, facts);

      const runtime = createRuleRuntimeState();
      const deadline = rule.sustainedFor + rule.after + 5;
      let fired = false;
      for (let t = 1; t <= deadline; t++) {
        if (stepRulesForRegion([rule], runtime, facts, t as Tick, []).length > 0) {
          fired = true;
          break;
        }
      }
      expect(fired, `rule '${rule.id}' never fired within sustainedFor+after+5 ticks`).toBe(true);
    });
  }
});
