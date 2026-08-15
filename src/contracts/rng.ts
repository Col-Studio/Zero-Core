/**
 * FROZEN — integration lead only. See CLAUDE.md § Frozen files.
 *
 * Deterministic RNG. `Math.random()` is banned project-wide (CI greps for it) because the whole
 * project rests on one promise: same seed + same tick ⇒ identical state hash and a visually
 * identical frame, on any machine.
 *
 * Algorithm is mulberry32: 32-bit state, fast, good distribution, trivially serializable.
 *
 * ## Forking — read this before drawing a single number
 *
 * Seven modules drawing from one shared stream would desync each other: if `creatures` draws one
 * extra number this frame, every later draw in `world` shifts and the world silently changes.
 * So each module (and each subsystem) takes its own named sub-stream:
 *
 *   const rng = createRng(seed).fork('ecology');
 *   const herdRng = rng.fork('herds');
 *
 * Forks are derived from the label's hash, so the same label always yields the same sub-stream
 * regardless of call order or what any other module does. Never share an Rng across subsystems.
 */

/** Deterministic pseudo-random source. Never construct directly — use `createRng`. */
export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  /** Uniform float in [min, max). */
  range(min: number, max: number): number;
  /** True with probability `p`. */
  chance(p: number): boolean;
  /** Uniform element. Throws on an empty array — an empty pick is always a logic bug. */
  pick<T>(items: readonly T[]): T;
  /** Weighted pick. Weights need not sum to 1; non-positive weights are skipped. */
  weighted<T>(items: readonly T[], weights: readonly number[]): T;
  /** In-place Fisher-Yates shuffle. Returns the same array for chaining. */
  shuffle<T>(items: T[]): T[];
  /** Approx. standard normal (Box-Muller), mean 0, stddev 1. */
  gauss(): number;
  /** Normal sample with the given mean and stddev, optionally clamped. */
  normal(mean: number, stddev: number, min?: number, max?: number): number;
  /** A named independent sub-stream. Same label ⇒ same stream, always. */
  fork(label: string): Rng;
  /** Current internal state — for save/load. */
  save(): number;
  /** Restore a previously saved state. */
  restore(state: number): void;
}

/**
 * FNV-1a, 32-bit. Used for fork labels and state hashing. Deterministic across engines because
 * it stays in 32-bit integer space via Math.imul.
 */
export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function createRng(seed: number | string): Rng {
  let state = (typeof seed === 'string' ? hashString(seed) : Math.trunc(seed)) >>> 0;
  // Seed 0 degenerates (mulberry32 emits a long run of near-zero values), so nudge it.
  if (state === 0) state = 0x9e3779b9;

  // The seed this generator was born with. `fork` derives from this and never from the live
  // `state`, which is what makes a fork independent of the parent's draw count.
  const rootSeed = state;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // Box-Muller produces two normals per pair of uniforms; cache the spare.
  let spare: number | null = null;

  const rng: Rng = {
    next,

    int(min, max) {
      if (max < min) [min, max] = [max, min];
      return min + Math.floor(next() * (max - min + 1));
    },

    range(min, max) {
      return min + next() * (max - min);
    },

    chance(p) {
      return next() < p;
    },

    pick(items) {
      if (items.length === 0) throw new Error('rng.pick: empty array');
      return items[Math.floor(next() * items.length)]!;
    },

    weighted(items, weights) {
      if (items.length === 0) throw new Error('rng.weighted: empty array');
      if (items.length !== weights.length) {
        throw new Error(`rng.weighted: ${items.length} items vs ${weights.length} weights`);
      }
      let total = 0;
      for (const w of weights) if (w > 0) total += w;
      if (total <= 0) return items[0]!;

      let roll = next() * total;
      for (let i = 0; i < items.length; i++) {
        const w = weights[i]!;
        if (w <= 0) continue;
        roll -= w;
        if (roll <= 0) return items[i]!;
      }
      return items[items.length - 1]!;
    },

    shuffle(items) {
      for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const tmp = items[i]!;
        items[i] = items[j]!;
        items[j] = tmp;
      }
      return items;
    },

    gauss() {
      if (spare !== null) {
        const value = spare;
        spare = null;
        return value;
      }
      // Guard against log(0).
      let u = next();
      while (u === 0) u = next();
      const v = next();
      const mag = Math.sqrt(-2 * Math.log(u));
      spare = mag * Math.sin(2 * Math.PI * v);
      return mag * Math.cos(2 * Math.PI * v);
    },

    normal(mean, stddev, min, max) {
      let value = mean + rng.gauss() * stddev;
      if (min !== undefined) value = Math.max(min, value);
      if (max !== undefined) value = Math.min(max, value);
      return value;
    },

    fork(label) {
      // Derive from `rootSeed`, NOT the live `state` — otherwise a fork taken after N draws
      // differs from the same-labelled fork taken before them, and two modules that fork at
      // different moments silently desync. That bug is the whole reason forks exist.
      return createRng((hashString(label) ^ rootSeed) >>> 0);
    },

    save() {
      return state;
    },

    restore(saved) {
      state = saved >>> 0;
      spare = null;
    },
  };

  return rng;
}

/**
 * Stable structural hash of any sim state. Determinism tests compare these:
 *
 *   expect(hashState(runSim(42))).toBe(hashState(runSim(42)));
 *
 * Object keys are sorted, so insertion order never affects the result. Floats are quantised to
 * `precision` decimals (default 6) so that harmless last-bit drift between machines doesn't
 * produce false failures while real divergence still does.
 */
export function hashState(value: unknown, precision = 6): string {
  const factor = 10 ** precision;
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;

  const feed = (text: string): void => {
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      h1 ^= c;
      h1 = Math.imul(h1, 0x01000193);
      h2 = Math.imul(h2 ^ c, 0x85ebca6b);
      h2 ^= h2 >>> 13;
    }
  };

  const seen = new WeakSet<object>();

  const walk = (node: unknown): void => {
    if (node === null) return feed('null');
    if (node === undefined) return feed('undef');

    switch (typeof node) {
      case 'number': {
        if (Number.isNaN(node)) return feed('nan');
        if (!Number.isFinite(node)) return feed(node > 0 ? 'inf' : '-inf');
        // -0 and 0 must hash identically.
        const q = Math.round(node * factor) / factor;
        return feed(String(q === 0 ? 0 : q));
      }
      case 'boolean':
        return feed(node ? 'T' : 'F');
      case 'string':
        return feed(`s${node.length}:${node}`);
      case 'bigint':
        return feed(`n${node.toString()}`);
      case 'function':
        return feed('fn');
      case 'symbol':
        return feed('sym');
    }

    const obj = node as object;
    if (seen.has(obj)) return feed('cycle');
    seen.add(obj);

    if (Array.isArray(obj)) {
      feed(`[${obj.length}`);
      for (const item of obj) {
        walk(item);
        feed(',');
      }
      return feed(']');
    }

    if (obj instanceof Map) {
      feed('M');
      const entries = [...obj.entries()].map(
        ([k, v]) => [typeof k === 'string' ? k : hashState(k, precision), v] as const,
      );
      entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
      for (const [k, v] of entries) {
        feed(k);
        feed(':');
        walk(v);
      }
      return;
    }

    if (obj instanceof Set) {
      feed('S');
      const items = [...obj].map((item) =>
        typeof item === 'string' ? item : hashState(item, precision),
      );
      items.sort();
      for (const item of items) {
        feed(item);
        feed(',');
      }
      return;
    }

    if (ArrayBuffer.isView(obj)) {
      const view = obj as unknown as ArrayLike<number>;
      feed(`TA${view.length}`);
      for (let i = 0; i < view.length; i++) walk(view[i]);
      return;
    }

    feed('{');
    for (const key of Object.keys(obj).sort()) {
      feed(key);
      feed(':');
      walk((obj as Record<string, unknown>)[key]);
      feed(',');
    }
    feed('}');
  };

  walk(value);
  return ((h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0'));
}
