import { describe, expect, it } from 'vitest';
import { createRng, speciesId, type Tick } from '@contracts/index';
import { advanceToTick, applyKillToState, simulateEcology } from '../../src/ecology/sim';
import { createInitialState, deserializeState, serializeState, computeStateHash } from '../../src/ecology/state';
import { syntheticRegions } from '../../src/ecology/regions';
import { SCENARIOS } from '../../src/ecology/dev/scenario';

const WOLF = speciesId('grey_wolf');

describe('determinism', () => {
  it('same seed + same scripted kills ⇒ identical state hash', () => {
    const a = simulateEcology(42, 20_000, SCENARIOS['kill all wolves']);
    const b = simulateEcology(42, 20_000, SCENARIOS['kill all wolves']);
    expect(computeStateHash(a.state)).toBe(computeStateHash(b.state));
  });

  it('different seeds diverge (sanity check that the hash is actually sensitive to state)', () => {
    const a = simulateEcology(1, 5_000, []);
    const b = simulateEcology(2, 5_000, []);
    expect(computeStateHash(a.state)).not.toBe(computeStateHash(b.state));
  });

  it('save/load mid-run reproduces byte-identical continuation, including any pending rule timers and the migration queue', () => {
    const regions = syntheticRegions();
    const region = regions[0]!.id;

    function buildAndAdvanceTo(tick: number) {
      const rng = createRng(42).fork('determinism-test');
      const state = createInitialState(regions, rng);
      for (let i = 0; i < 20; i++) {
        advanceToTick(state, (1000 + i * 5) as Tick);
        applyKillToState(state, WOLF, region, true);
      }
      advanceToTick(state, tick as Tick);
      return state;
    }

    // Run straight through to 12 000 ticks with no save/load.
    const straight = buildAndAdvanceTo(6_000);
    advanceToTick(straight, 12_000 as Tick);

    // Build to the same midpoint, serialize, deserialize, then continue to the same endpoint.
    const midpoint = buildAndAdvanceTo(6_000);
    const restored = deserializeState(serializeState(midpoint));
    advanceToTick(restored, 12_000 as Tick);

    expect(computeStateHash(restored)).toBe(computeStateHash(straight));
  });

  it('serializeState/deserializeState round-trips without throwing on a freshly created state', () => {
    const rng = createRng(1).fork('roundtrip');
    const state = createInitialState(syntheticRegions(), rng);
    const restored = deserializeState(serializeState(state));
    expect(computeStateHash(restored)).toBe(computeStateHash(state));
  });
});
