/**
 * The nature-rules engine's central deliverable: the full rule table. Pure data, assembled from
 * the four source files. See rules.types.ts for the shape and rulesEngine.ts for evaluation.
 */

import { TROPHIC_RULES } from './natureRules.trophic.data';
import { RESOURCE_RULES } from './natureRules.resource.data';
import { SOCIAL_RULES } from './natureRules.social.data';
import { VARIANT_RULES } from './natureRules.variants.data';
import type { NatureRule } from './rules.types';

export const ALL_RULES: readonly NatureRule[] = [
  ...TROPHIC_RULES,
  ...RESOURCE_RULES,
  ...SOCIAL_RULES,
  ...VARIANT_RULES,
];

export const RULES_BY_ID: ReadonlyMap<string, NatureRule> = new Map(ALL_RULES.map((r) => [r.id, r]));

// Fail loudly at import time if two rules collide on id — a silent duplicate would make one of
// them unreachable, which is exactly what tests/ecology/rules-reachability.test.ts checks for.
if (RULES_BY_ID.size !== ALL_RULES.length) {
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const r of ALL_RULES) {
    if (seen.has(r.id)) dupes.push(r.id);
    seen.add(r.id);
  }
  throw new Error(`ecology: duplicate nature rule id(s): ${dupes.join(', ')}`);
}
