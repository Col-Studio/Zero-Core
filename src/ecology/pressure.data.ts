/**
 * Decay is read-time, not a background process (see pressure.ts) — half-life is chosen so a
 * kill still meaningfully colours behaviour an in-game hour later but a season-old massacre has
 * mostly faded, matching the card's "remembers what the player did to it, with slow decay".
 */

/** Half-life of a single kill's contribution to `pressure`, in ticks. ~20 min at 20 Hz. */
export const PRESSURE_HALF_LIFE_TICKS = 24_000;

/** Kills-per-capacity-fraction that saturates `pressure` at 1 (relentlessly hunted). */
export const PRESSURE_SATURATION_FRACTION = 0.5;
