/** Tuning for the reference simulation. Numbers live here, logic lives in `reference.ts`. */

export const REF = {
  /** Radius of the drifting shoal, in metres. */
  fieldRadius: 90,
  /** Tangential acceleration — the swirl. m/s². */
  swirl: 1.6,
  /** Pull back toward the ring at 0.7 × radius, so the shoal neither collapses nor escapes. */
  cohesion: 0.045,
  /** Vertical bob amplitude and rate. */
  bobAmplitude: 0.9,
  bobRate: 0.035,
  /** Velocity damping per step. Below 1 or energy accumulates and the shoal flies apart. */
  damping: 0.985,
  /** Maximum speed, m/s. */
  maxSpeed: 9,
  /** Ticks between churn events (a death and a birth). 20 ticks = 1 simulated second. */
  churnInterval: 20,
  /** Entities replaced per churn event. Keeps the event tail readable, not a firehose. */
  churnCount: 2,
  /** Starting health, and damage taken per attack when the attack does not specify. */
  health: 100,
  defaultDamage: 45,
  /** Species names used by the reference sim. Deliberately the same vocabulary as the Nulls. */
  species: ['wolf', 'deer', 'hare', 'boar'] as const,
} as const;
