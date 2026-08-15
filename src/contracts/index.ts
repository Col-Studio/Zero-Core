/**
 * FROZEN — integration lead only. See CLAUDE.md § Frozen files.
 *
 * The contracts barrel. Modules may import from `@contracts` or from a specific file
 * (`@contracts/rng`) — both work, and nothing else outside your own folder is importable.
 *
 * If something you need is missing here, do NOT add it yourself: write the request in your
 * INTEGRATION_NOTES.md and the integration lead will amend the contracts for all seven branches
 * at once. Divergent contracts are the one thing that breaks this architecture.
 */

export * from './ids';
export * from './rng';
export * from './events';
export * from './services';
export * from './registry';
export {
  createNullServices,
  createNullWorldQuery,
  createNullEcologyQuery,
  createNullCreatureQuery,
  createNullPlayerQuery,
  createNullSocietyQuery,
  createNullPresentation,
  nullHeightAt,
  NULL_SPECIES,
  type NullPresentation,
  type RecordedCall,
} from './nulls';

/** URL parameters that drive every debug scene. Parsed once by the shell. */
export interface SessionParams {
  seed: number;
  scene: string | null;
  /** Fast-forward the simulation to this tick before the first render. */
  tick: number;
  /** Pin camera and time so screenshots are comparable. */
  freeze: boolean;
}

const DEFAULT_SEED = 42;

/** `Number('')` is 0, so an empty param value must be treated as absent, not as zero. */
function numParam(params: URLSearchParams, key: string): number | null {
  const raw = params.get(key);
  if (raw === null || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * Parse `?seed=42&scene=terrain&tick=2000&freeze=1`.
 *
 * Every malformed value falls back to its default rather than producing NaN or 0 — a NaN seed
 * would make `createRng` emit one fixed degenerate stream, silently breaking every module's
 * determinism test with no error to point at.
 *
 * Accepts a query string so it is testable headlessly:
 *   parseSessionParams('?seed=7&scene=sky')
 */
export function parseSessionParams(search?: string): SessionParams {
  const raw =
    search ?? (typeof window === 'undefined' ? '' : window.location.search);
  const params = new URLSearchParams(raw);

  const seed = numParam(params, 'seed');
  const tick = numParam(params, 'tick');
  const scene = params.get('scene');
  const freeze = params.get('freeze');

  return {
    seed: seed === null ? DEFAULT_SEED : Math.trunc(seed),
    // An empty `?scene=` must be null, not '', or every module's scene switch matches a scene
    // named ''.
    scene: scene === null || scene.trim() === '' ? null : scene,
    tick: tick !== null && tick > 0 ? Math.trunc(tick) : 0,
    freeze: freeze === '1' || freeze === 'true',
  };
}

/**
 * Signal to `scripts/shot.mjs` that a scene has finished loading and reached its target tick.
 * The screenshot harness waits on this flag, so every debug scene must call it exactly once.
 */
export function markReady(): void {
  if (typeof window !== 'undefined') {
    (window as unknown as { __READY__?: boolean }).__READY__ = true;
  }
}
