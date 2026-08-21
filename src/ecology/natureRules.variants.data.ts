/**
 * The trophic web has 24 species; hand-authoring a bespoke narrative for every predator/prey and
 * protect/overhunt combination would either stop at a handful of "marquee" pairs (see
 * natureRules.trophic/resource/social.data.ts) or balloon into an unmaintainable wall of
 * near-duplicate literals. Instead, the remaining combinations are generated once, at module
 * load, from small explicit tuple tables below — still fully deterministic data, just expressed
 * more compactly. Every generated rule still gets its own narrative line, so the player never
 * reads the same sentence twice even if the *shape* of the rule repeats.
 */

import { speciesDef, SPECIES_IDS as S, type SpeciesDef } from './species.data';
import type { NatureRule } from './rules.types';

interface CollapseReleaseSpec {
  predator: SpeciesDef;
  released: SpeciesDef;
  narrative: string;
}

const COLLAPSE_RELEASE: readonly CollapseReleaseSpec[] = [
  { predator: speciesDef(S.alpineFalcon), released: speciesDef(S.hare), narrative: 'No falcon rides the thermals above the ridge anymore.' },
  { predator: speciesDef(S.desertJackal), released: speciesDef(S.dustAntelope), narrative: 'Jackal tracks have gone cold across the badlands.' },
  { predator: speciesDef(S.marshHeron), released: speciesDef(S.lakeFish), narrative: 'The heron\'s hunting perch by the reeds sits empty.' },
] as const;

function collapseReleaseRules(specs: readonly CollapseReleaseSpec[]): NatureRule[] {
  return specs.map(({ predator, released, narrative }) => ({
    id: `collapse_release_${predator.id}`,
    when: { kind: 'population', species: predator.id, op: '<', value: 0.15 },
    sustainedFor: 150,
    after: 60,
    then: [{ kind: 'populationRate', species: released.id, multiplier: 1.35, durationTicks: 7_000 }],
    narrative,
    severity: 'notable',
    blamedSpecies: predator.id,
  }));
}

interface ProtectSpec {
  species: SpeciesDef;
  reward: SpeciesDef;
  narrative: string;
}

const PROTECT: readonly ProtectSpec[] = [
  { species: speciesDef(S.direWolf), reward: speciesDef(S.redDeer), narrative: 'The dire wolves have kept their territory undisturbed for a long season.' },
  { species: speciesDef(S.caveBear), reward: speciesDef(S.mountainGoat), narrative: 'The cave bear still rules the high passes, and the goats have learned to read its moods.' },
  { species: speciesDef(S.swampWyrm), reward: speciesDef(S.marshElk), narrative: 'Whatever moves beneath the swamp, it has been left well alone.' },
  { species: speciesDef(S.lynx), reward: speciesDef(S.alpineMoss), narrative: 'The lynx population has held steady for a long while — the meadow shows it.' },
  { species: speciesDef(S.riverOtter), reward: speciesDef(S.lakeAlgae), narrative: 'Otters still play in the shallows undisturbed, and the lake runs clear.' },
] as const;

function protectRules(specs: readonly ProtectSpec[]): NatureRule[] {
  return specs.map(({ species, reward, narrative }) => ({
    id: `protect_${species.id}_flourish`,
    when: {
      kind: 'compound',
      op: 'AND',
      conditions: [
        { kind: 'population', species: species.id, op: '>', value: 0.75 },
        { kind: 'playerKills', species: species.id, op: '<', value: 1 },
      ],
    },
    sustainedFor: 5_000,
    after: 1_000,
    then: [{ kind: 'populationRate', species: reward.id, multiplier: 1.15, durationTicks: 10_000 }],
    narrative,
    severity: 'notable' as const,
    once: true,
  }));
}

interface OverhuntSpec {
  species: SpeciesDef;
  effectOn: SpeciesDef;
  narrative: string;
}

const OVERHUNT: readonly OverhuntSpec[] = [
  { species: speciesDef(S.marshElk), effectOn: speciesDef(S.swampWyrm), narrative: 'Elk sign has all but vanished from the marsh trails.' },
  { species: speciesDef(S.mountainGoat), effectOn: speciesDef(S.caveBear), narrative: 'The high pastures are eerily empty of goats this season.' },
  { species: speciesDef(S.lakeFish), effectOn: speciesDef(S.riverOtter), narrative: 'Nets come up light on the lake, season after season.' },
] as const;

function overhuntRules(specs: readonly OverhuntSpec[]): NatureRule[] {
  return specs.map(({ species, effectOn, narrative }) => ({
    id: `herbivore_overhunted_${species.id}`,
    when: { kind: 'playerKills', species: species.id, op: '>', value: 9 },
    sustainedFor: 80,
    after: 150,
    then: [{ kind: 'populationRate', species: effectOn.id, multiplier: 0.85, durationTicks: 6_000 }],
    narrative,
    severity: 'notable' as const,
    blamedSpecies: species.id,
  }));
}

const OVERCROWD_DISEASE_SPECIES: readonly { species: SpeciesDef; narrative: string }[] = [
  { species: speciesDef(S.hare), narrative: 'The hare warren has grown so dense that sickness is spreading through it.' },
  { species: speciesDef(S.marshElk), narrative: 'Too many elk crowd too little marsh; a wasting sickness follows.' },
  { species: speciesDef(S.mountainGoat), narrative: 'The goat herd has outgrown the high pasture, and it shows in their ribs.' },
  { species: speciesDef(S.dustAntelope), narrative: 'The antelope herd is thinning from disease born of its own crowding.' },
] as const;

function overcrowdDiseaseRules(specs: typeof OVERCROWD_DISEASE_SPECIES): NatureRule[] {
  return specs.map(({ species, narrative }) => ({
    id: `overcrowd_disease_${species.id}`,
    when: { kind: 'population', species: species.id, op: '>', value: 0.95 },
    sustainedFor: 600,
    after: 150,
    then: [{ kind: 'populationShock', species: species.id, fractionDelta: -0.22 }],
    narrative,
    severity: 'notable' as const,
  }));
}

const NICHE_VACANT_SPECIES: readonly { species: SpeciesDef; narrative: string }[] = [
  { species: speciesDef(S.mountainGoat), narrative: 'The high pasture stands empty. Something will come to claim it.' },
  { species: speciesDef(S.marshElk), narrative: 'The marsh has lost its elk entirely. The reeds grow wild and untouched.' },
] as const;

function nicheVacantRules(specs: typeof NICHE_VACANT_SPECIES): NatureRule[] {
  return specs.map(({ species, narrative }) => ({
    id: `niche_vacant_${species.id}`,
    when: { kind: 'population', species: species.id, op: '<', value: species.migrationThreshold },
    sustainedFor: 2_000,
    after: 800,
    then: [{ kind: 'migration', species: species.id, direction: 'in', reason: 'niche-vacant', countFraction: 0.4, fromAdjacent: true }],
    narrative,
    severity: 'major' as const,
    blamedSpecies: species.id,
  }));
}

export const VARIANT_RULES: NatureRule[] = [
  ...collapseReleaseRules(COLLAPSE_RELEASE),
  ...protectRules(PROTECT),
  ...overhuntRules(OVERHUNT),
  ...overcrowdDiseaseRules(OVERCROWD_DISEASE_SPECIES),
  ...nicheVacantRules(NICHE_VACANT_SPECIES),
];
