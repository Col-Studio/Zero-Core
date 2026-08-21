import { describe, expect, it } from 'vitest';
import { regionId, speciesId, type SpeciesId, type Tick } from '@contracts/index';
import {
  createRuleRuntimeState,
  evaluateCondition,
  ruleReferencesKnownSpecies,
  stepRulesForRegion,
  type RegionFacts,
} from '../../src/ecology/rulesEngine';
import type { NatureRule } from '../../src/ecology/rules.types';
import { ALL_RULES } from '../../src/ecology/natureRules.data';
import { SPECIES } from '../../src/ecology/species.data';

const REGION = regionId('r0');
const WOLF = speciesId('grey_wolf');

function factsWith(overrides: Partial<RegionFacts>): RegionFacts {
  return {
    regionId: REGION,
    populationNormalized: {},
    vegetation: 0.5,
    playerKillsDecayed: {},
    weather: 'clear',
    economyStress: 0.5,
    ...overrides,
  };
}

const TEST_RULE: NatureRule = {
  id: 'test_rule',
  when: { kind: 'population', species: WOLF, op: '<', value: 0.2 },
  sustainedFor: 10,
  after: 5,
  then: [],
  narrative: 'test',
  severity: 'minor',
};

describe('evaluateCondition', () => {
  it('evaluates a simple population condition', () => {
    expect(evaluateCondition(TEST_RULE.when, factsWith({ populationNormalized: { [WOLF]: 0.1 } }))).toBe(true);
    expect(evaluateCondition(TEST_RULE.when, factsWith({ populationNormalized: { [WOLF]: 0.5 } }))).toBe(false);
  });

  it('AND requires every sub-condition; OR requires at least one', () => {
    const and = { kind: 'compound' as const, op: 'AND' as const, conditions: [TEST_RULE.when, { kind: 'vegetation' as const, op: '<' as const, value: 0.3 }] };
    expect(evaluateCondition(and, factsWith({ populationNormalized: { [WOLF]: 0.1 }, vegetation: 0.1 }))).toBe(true);
    expect(evaluateCondition(and, factsWith({ populationNormalized: { [WOLF]: 0.1 }, vegetation: 0.9 }))).toBe(false);

    const or = { kind: 'compound' as const, op: 'OR' as const, conditions: and.conditions };
    expect(evaluateCondition(or, factsWith({ populationNormalized: { [WOLF]: 0.1 }, vegetation: 0.9 }))).toBe(true);
  });
});

describe('stepRulesForRegion timing', () => {
  it('does not fire before sustainedFor + after ticks have elapsed', () => {
    const runtime = createRuleRuntimeState();
    const facts = factsWith({ populationNormalized: { [WOLF]: 0.1 } });
    for (let t = 1; t <= 14; t++) {
      const fired = stepRulesForRegion([TEST_RULE], runtime, facts, t as Tick, []);
      expect(fired).toHaveLength(0);
    }
  });

  it('fires exactly once at sustainedFor + after, then again only if it re-qualifies', () => {
    const runtime = createRuleRuntimeState();
    const facts = factsWith({ populationNormalized: { [WOLF]: 0.1 } });
    let fireTick: number | null = null;
    for (let t = 1; t <= 20; t++) {
      const fired = stepRulesForRegion([TEST_RULE], runtime, facts, t as Tick, []);
      if (fired.length > 0) {
        expect(fireTick).toBeNull();
        fireTick = t;
      }
    }
    expect(fireTick).toBe(15); // sustainedFor(10) + after(5)
  });

  it('resets the sustain timer if the condition drops before it fires', () => {
    const runtime = createRuleRuntimeState();
    for (let t = 1; t <= 5; t++) {
      stepRulesForRegion([TEST_RULE], runtime, factsWith({ populationNormalized: { [WOLF]: 0.1 } }), t as Tick, []);
    }
    // Condition goes false right before it would have qualified.
    stepRulesForRegion([TEST_RULE], runtime, factsWith({ populationNormalized: { [WOLF]: 0.9 } }), 6 as Tick, []);
    let fired = false;
    for (let t = 7; t <= 15; t++) {
      if (stepRulesForRegion([TEST_RULE], runtime, factsWith({ populationNormalized: { [WOLF]: 0.1 } }), t as Tick, []).length > 0) fired = true;
    }
    expect(fired).toBe(false); // needed 10 more ticks from t=7, i.e. fires at t=22, not by t=15
  });

  it('a `once` rule never fires a second time even if the condition holds again', () => {
    const onceRule: NatureRule = { ...TEST_RULE, id: 'once_rule', once: true };
    const runtime = createRuleRuntimeState();
    const facts = factsWith({ populationNormalized: { [WOLF]: 0.1 } });
    let fireCount = 0;
    for (let t = 1; t <= 60; t++) {
      fireCount += stepRulesForRegion([onceRule], runtime, facts, t as Tick, []).length;
    }
    expect(fireCount).toBe(1);
  });

  it('chain only includes declared ids that actually fired recently', () => {
    const parent: NatureRule = { ...TEST_RULE, id: 'parent', sustainedFor: 1, after: 0 };
    const child: NatureRule = { ...TEST_RULE, id: 'child', sustainedFor: 1, after: 0, chain: ['parent', 'never_fired'] };
    const runtime = createRuleRuntimeState();
    const facts = factsWith({ populationNormalized: { [WOLF]: 0.1 } });
    stepRulesForRegion([parent], runtime, facts, 1 as Tick, []);
    const fired = stepRulesForRegion([child], runtime, facts, 2 as Tick, ['parent']);
    expect(fired[0]!.chain).toEqual(['parent', 'child']);
  });
});

describe('the full rule table', () => {
  it('has at least 60 rules', () => {
    expect(ALL_RULES.length).toBeGreaterThanOrEqual(60);
  });

  it('every rule has a unique id', () => {
    const ids = new Set(ALL_RULES.map((r) => r.id));
    expect(ids.size).toBe(ALL_RULES.length);
  });

  it('every rule only references species that exist in the trophic web', () => {
    const known = new Set<SpeciesId>(SPECIES.map((s) => s.id));
    for (const rule of ALL_RULES) {
      expect(ruleReferencesKnownSpecies(rule, known), `rule '${rule.id}' references an unknown species`).toBe(true);
    }
  });

  it('every rule declares a non-empty narrative', () => {
    for (const rule of ALL_RULES) {
      expect(rule.narrative.length, `rule '${rule.id}' has no narrative`).toBeGreaterThan(10);
    }
  });
});
