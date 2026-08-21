/**
 * Season tuning. `ecology` keeps its own calendar derived purely from tick count (see
 * seasons.ts) rather than depending on `world`'s `time:phase` event, which a Null `world` never
 * emits — see INTEGRATION_NOTES.md for why, and the alignment note for whoever merges `world`.
 */

import type { Season } from '@contracts/index';

/** One season lasts this many ticks. ~6 000 ticks = 5 simulated minutes at 20 Hz. */
export const SEASON_LENGTH_TICKS = 6_000;
export const YEAR_LENGTH_TICKS = SEASON_LENGTH_TICKS * 4;

export const SEASON_ORDER: readonly Season[] = ['spring', 'summer', 'autumn', 'winter'];

export interface SeasonModifiers {
  /** Multiplies every species' reproductionRate. */
  reproduction: number;
  /** Multiplies vegetation regrowth. */
  vegetationGrowth: number;
  /** Additive bias to migration likelihood checks, -1..1. */
  migrationBias: number;
  /** Multiplies starvation rate — winter hurts, per the card. */
  starvation: number;
}

export const SEASON_MODIFIERS: Readonly<Record<Season, SeasonModifiers>> = {
  spring: { reproduction: 1.35, vegetationGrowth: 1.3, migrationBias: 0.15, starvation: 0.85 },
  summer: { reproduction: 1.1, vegetationGrowth: 1.15, migrationBias: 0.0, starvation: 0.8 },
  autumn: { reproduction: 0.9, vegetationGrowth: 0.85, migrationBias: 0.1, starvation: 1.05 },
  winter: { reproduction: 0.55, vegetationGrowth: 0.5, migrationBias: -0.1, starvation: 1.45 },
};
