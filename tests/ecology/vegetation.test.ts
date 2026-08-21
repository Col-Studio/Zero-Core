import { describe, expect, it } from 'vitest';
import { stepVegetation } from '../../src/ecology/vegetation';
import { SEASON_MODIFIERS } from '../../src/ecology/seasons.data';
import { FIRE_LOSS_FRACTION } from '../../src/ecology/vegetation.data';

const baseInput = {
  biome: 'forest' as const,
  producerHealth: 0.8,
  grazingPressure: 0.4,
  waterAvailability: 0.7,
  season: SEASON_MODIFIERS.summer,
  fireNow: false,
  fireFertilizationTicksLeft: 0,
};

describe('vegetation model', () => {
  it('regrows toward a higher target when current density is below it', () => {
    const result = stepVegetation({ ...baseInput, current: 0.2 });
    expect(result.density).toBeGreaterThan(0.2);
  });

  it('declines toward a lower target under heavy grazing pressure', () => {
    const light = stepVegetation({ ...baseInput, current: 0.6, grazingPressure: 0.2 });
    const heavy = stepVegetation({ ...baseInput, current: 0.6, grazingPressure: 1.2 });
    expect(heavy.density).toBeLessThan(light.density);
  });

  it('a fire instantly removes a large fraction of standing vegetation', () => {
    const before = 0.7;
    const result = stepVegetation({ ...baseInput, current: before, fireNow: true });
    expect(result.density).toBeLessThan(before * (1 - FIRE_LOSS_FRACTION) + 0.05);
    expect(result.fireFertilizationTicksLeft).toBeGreaterThan(0);
  });

  it('post-fire fertilization regrows vegetation faster than the unfertilized baseline', () => {
    const normal = stepVegetation({ ...baseInput, current: 0.2, fireFertilizationTicksLeft: 0 });
    const fertilized = stepVegetation({ ...baseInput, current: 0.2, fireFertilizationTicksLeft: 2000 });
    expect(fertilized.density).toBeGreaterThan(normal.density);
  });

  it('density always stays within [0, 1]', () => {
    const low = stepVegetation({ ...baseInput, current: 0, grazingPressure: 5 });
    const high = stepVegetation({ ...baseInput, current: 1, grazingPressure: 0, waterAvailability: 1 });
    expect(low.density).toBeGreaterThanOrEqual(0);
    expect(high.density).toBeLessThanOrEqual(1);
  });
});
