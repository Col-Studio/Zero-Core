import { describe, expect, it } from 'vitest';
import { simulateEcology } from '../../src/ecology/sim';
import { fuzzRegions } from '../../src/ecology/regions';
import { SPECIES } from '../../src/ecology/species.data';

// The card's own bar: "No-player-input world stays stable ... over 500k ticks across 20
// different seeds." Runs on the 4-region fuzz map (see regions.ts) to keep this fast — the
// per-tick cost is O(regions x species), so a smaller map is a legitimate way to afford the
// full tick count without changing the dynamics being tested. This is the slow test in the
// suite by design; the generous per-test timeout below reflects that, not a perf problem.
describe('long-horizon stability (no player input)', () => {
  const seeds = Array.from({ length: 20 }, (_, i) => i + 1);

  it(
    'no population collapses to zero or blows past the overshoot cap, across 20 seeds x 500k ticks',
    () => {
      for (const seed of seeds) {
        const result = simulateEcology(seed, 500_000, [], fuzzRegions());
        for (const p of result.populations) {
          const species = SPECIES.find((s) => s.id === p.speciesId)!;
          // Off-biome populations are allowed to sit near zero (they were never viable there);
          // only check species actually native to that population's region.
          const region = result.regions.find((r) => r.id === p.regionId)!;
          if (!species.biomeAffinity.includes(region.biome)) continue;

          expect(p.normalized, `seed ${seed}: ${p.speciesId} in ${p.regionId} collapsed to zero`).toBeGreaterThan(0);
          expect(p.normalized, `seed ${seed}: ${p.speciesId} in ${p.regionId} exceeded the overshoot cap`).toBeLessThan(1.4);
        }
        for (const [regionId, density] of Object.entries(result.vegetation)) {
          expect(density, `seed ${seed}: vegetation in ${regionId} out of [0,1]`).toBeGreaterThanOrEqual(0);
          expect(density, `seed ${seed}: vegetation in ${regionId} out of [0,1]`).toBeLessThanOrEqual(1);
        }
      }
    },
    180_000,
  );
});
