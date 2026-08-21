/** Per-tick fraction of the population gradient that flows between adjacent regions. */
export const DIFFUSION_RATE = 0.0006;

/** A rule-triggered migration arrives this many ticks after being scheduled — "realistic delay". */
export const MIGRATION_DELAY_TICKS = 400;

/** Overcrowded regions (see population.data.ts OVERCROWDING_THRESHOLD) emigrate at this rate. */
export const OVERCROWDING_EMIGRATION_RATE = 0.002;
