/**
 * Pure functions deriving the calendar from tick count. No wall-clock, no state — same tick
 * always yields the same season (CLAUDE.md § Hard invariant 3 and 10).
 */

import type { Season, Tick } from '@contracts/index';
import { SEASON_LENGTH_TICKS, SEASON_MODIFIERS, SEASON_ORDER, YEAR_LENGTH_TICKS, type SeasonModifiers } from './seasons.data';

export function seasonAt(tick: Tick): Season {
  const intoYear = ((tick % YEAR_LENGTH_TICKS) + YEAR_LENGTH_TICKS) % YEAR_LENGTH_TICKS;
  const index = Math.floor(intoYear / SEASON_LENGTH_TICKS) % SEASON_ORDER.length;
  return SEASON_ORDER[index]!;
}

export function dayCountAt(tick: Tick): number {
  // Arbitrary but stable: a "day" is 1/12th of a season, so ~30 days/year.
  const dayLength = SEASON_LENGTH_TICKS / 30;
  return Math.floor(tick / dayLength);
}

export function modifiersAt(tick: Tick): SeasonModifiers {
  return SEASON_MODIFIERS[seasonAt(tick)];
}
