/**
 * Determinism is the project's foundational promise: same seed + same tick ⇒ identical state
 * hash on any machine. Every module's own determinism test relies on `rng` and `hashState`
 * behaving exactly as asserted here, so these tests guard the guard.
 */

import { describe, expect, it } from 'vitest';
import { createRng, hashState, hashString } from '@contracts/rng';

describe('createRng', () => {
  it('produces an identical sequence for the same seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    const seqA = Array.from({ length: 500 }, () => a.next());
    const seqB = Array.from({ length: 500 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('produces different sequences for different seeds', () => {
    const a = Array.from({ length: 50 }, ((r) => () => r.next())(createRng(1)));
    const b = Array.from({ length: 50 }, ((r) => () => r.next())(createRng(2)));
    expect(a).not.toEqual(b);
  });

  it('accepts string seeds', () => {
    expect(createRng('world-zero').next()).toBe(createRng('world-zero').next());
    expect(createRng('a').next()).not.toBe(createRng('b').next());
  });

  it('does not degenerate on seed 0', () => {
    const values = Array.from({ length: 100 }, ((r) => () => r.next())(createRng(0)));
    const unique = new Set(values);
    expect(unique.size).toBeGreaterThan(90);
    expect(Math.max(...values)).toBeGreaterThan(0.5);
  });

  it('stays within [0, 1)', () => {
    const rng = createRng(7);
    for (let i = 0; i < 20_000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('distributes roughly uniformly across 10 buckets', () => {
    const rng = createRng(99);
    const buckets = new Array(10).fill(0);
    const n = 100_000;
    for (let i = 0; i < n; i++) buckets[Math.floor(rng.next() * 10)]++;
    // Each bucket should be within 10% of n/10.
    for (const count of buckets) {
      expect(count).toBeGreaterThan((n / 10) * 0.9);
      expect(count).toBeLessThan((n / 10) * 1.1);
    }
  });

  describe('int', () => {
    it('is inclusive on both ends and never out of range', () => {
      const rng = createRng(3);
      const seen = new Set<number>();
      for (let i = 0; i < 5000; i++) {
        const v = rng.int(1, 6);
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBeLessThanOrEqual(6);
        seen.add(v);
      }
      expect(seen.size).toBe(6);
    });

    it('handles reversed bounds and single-value ranges', () => {
      const rng = createRng(4);
      expect(rng.int(5, 5)).toBe(5);
      for (let i = 0; i < 100; i++) {
        const v = rng.int(9, 2);
        expect(v).toBeGreaterThanOrEqual(2);
        expect(v).toBeLessThanOrEqual(9);
      }
    });
  });

  describe('pick / weighted / shuffle', () => {
    it('throws on an empty pick — an empty pick is always a logic bug', () => {
      expect(() => createRng(1).pick([])).toThrow(/empty/);
      expect(() => createRng(1).weighted([], [])).toThrow(/empty/);
    });

    it('respects weights, and skips zero-weight entries entirely', () => {
      const rng = createRng(11);
      const counts = { a: 0, b: 0, c: 0 };
      for (let i = 0; i < 10_000; i++) {
        counts[rng.weighted(['a', 'b', 'c'] as const, [8, 2, 0])]++;
      }
      expect(counts.c).toBe(0);
      expect(counts.a).toBeGreaterThan(counts.b * 2);
    });

    it('rejects mismatched weight arrays', () => {
      expect(() => createRng(1).weighted(['a', 'b'], [1])).toThrow(/items vs/);
    });

    it('shuffles deterministically and preserves membership', () => {
      const source = Array.from({ length: 20 }, (_, i) => i);
      const a = createRng(5).shuffle([...source]);
      const b = createRng(5).shuffle([...source]);
      expect(a).toEqual(b);
      expect([...a].sort((x, y) => x - y)).toEqual(source);
    });
  });

  describe('gauss', () => {
    it('has approximately mean 0 and stddev 1', () => {
      const rng = createRng(17);
      const n = 100_000;
      let sum = 0;
      let sumSq = 0;
      for (let i = 0; i < n; i++) {
        const v = rng.gauss();
        sum += v;
        sumSq += v * v;
      }
      const mean = sum / n;
      const stddev = Math.sqrt(sumSq / n - mean * mean);
      expect(Math.abs(mean)).toBeLessThan(0.02);
      expect(Math.abs(stddev - 1)).toBeLessThan(0.02);
    });

    it('clamps when bounds are given', () => {
      const rng = createRng(19);
      for (let i = 0; i < 1000; i++) {
        const v = rng.normal(0, 10, -1, 1);
        expect(v).toBeGreaterThanOrEqual(-1);
        expect(v).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('fork — the anti-desync mechanism', () => {
    it('gives the same stream for the same label regardless of parent draw count', () => {
      const parentA = createRng(42);
      const forkA = parentA.fork('ecology').next();

      const parentB = createRng(42);
      // The parent draws first here — the fork must be unaffected.
      parentB.next();
      parentB.next();
      parentB.next();
      const forkB = parentB.fork('ecology').next();

      expect(forkA).toBe(forkB);
    });

    it('gives independent streams for different labels', () => {
      const parent = createRng(42);
      expect(parent.fork('world').next()).not.toBe(parent.fork('creatures').next());
    });

    it('is stable across the whole module set', () => {
      const labels = ['core', 'world', 'ecology', 'creatures', 'player', 'society', 'presentation'];
      const first = labels.map((l) => createRng(42).fork(l).next());
      const second = labels.map((l) => createRng(42).fork(l).next());
      expect(first).toEqual(second);
      expect(new Set(first).size).toBe(labels.length);
    });
  });

  describe('save / restore', () => {
    it('round-trips mid-stream state', () => {
      const rng = createRng(23);
      for (let i = 0; i < 10; i++) rng.next();
      const saved = rng.save();
      const expected = Array.from({ length: 20 }, () => rng.next());

      rng.restore(saved);
      expect(Array.from({ length: 20 }, () => rng.next())).toEqual(expected);
    });
  });
});

describe('hashString', () => {
  it('is stable and returns an unsigned 32-bit integer', () => {
    expect(hashString('wolf')).toBe(hashString('wolf'));
    expect(hashString('wolf')).not.toBe(hashString('deer'));
    const h = hashString('some longer string with spaces');
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
    expect(Number.isInteger(h)).toBe(true);
  });

  it('hashes the empty string without throwing', () => {
    expect(typeof hashString('')).toBe('number');
  });
});

describe('hashState', () => {
  it('is insensitive to object key order', () => {
    expect(hashState({ a: 1, b: 2 })).toBe(hashState({ b: 2, a: 1 }));
  });

  it('is sensitive to values, nesting, and array order', () => {
    expect(hashState({ a: 1 })).not.toBe(hashState({ a: 2 }));
    expect(hashState([1, 2, 3])).not.toBe(hashState([3, 2, 1]));
    expect(hashState({ a: { b: 1 } })).not.toBe(hashState({ a: { b: 2 } }));
  });

  it('distinguishes structurally similar but different shapes', () => {
    expect(hashState({ a: 1 })).not.toBe(hashState([1]));
    expect(hashState('1')).not.toBe(hashState(1));
    expect(hashState(null)).not.toBe(hashState(undefined));
  });

  it('treats -0 and 0 as identical', () => {
    expect(hashState({ v: -0 })).toBe(hashState({ v: 0 }));
  });

  it('quantises float noise below the precision threshold', () => {
    // Harmless last-bit drift between machines must not fail a determinism test...
    expect(hashState({ v: 1.000000001 })).toBe(hashState({ v: 1.0 }));
    // ...but real divergence must.
    expect(hashState({ v: 1.001 })).not.toBe(hashState({ v: 1.0 }));
  });

  it('handles NaN and infinities', () => {
    expect(hashState({ v: NaN })).toBe(hashState({ v: NaN }));
    expect(hashState({ v: Infinity })).not.toBe(hashState({ v: -Infinity }));
  });

  it('is order-insensitive for Maps and Sets', () => {
    const m1 = new Map([['a', 1], ['b', 2]]);
    const m2 = new Map([['b', 2], ['a', 1]]);
    expect(hashState(m1)).toBe(hashState(m2));

    expect(hashState(new Set([1, 2, 3]))).toBe(hashState(new Set([3, 1, 2])));
  });

  it('hashes typed arrays by content', () => {
    expect(hashState(new Float32Array([1, 2, 3]))).toBe(hashState(new Float32Array([1, 2, 3])));
    expect(hashState(new Float32Array([1, 2, 3]))).not.toBe(hashState(new Float32Array([1, 2, 4])));
  });

  it('survives circular references', () => {
    const a: Record<string, unknown> = { name: 'region' };
    a.self = a;
    expect(() => hashState(a)).not.toThrow();
    expect(hashState(a)).toBe(hashState(a));
  });

  it('produces a 16-char hex digest', () => {
    expect(hashState({ big: 'state' })).toMatch(/^[0-9a-f]{16}$/);
  });

  it('detects a single changed field in a large simulated state', () => {
    const build = (deerCount: number) => ({
      tick: 12_000,
      regions: Array.from({ length: 25 }, (_, i) => ({
        id: `r_${i}`,
        vegetation: 0.5 + i / 100,
        populations: { deer: i === 3 ? deerCount : 40, wolf: 12 },
      })),
    });
    expect(hashState(build(40))).toBe(hashState(build(40)));
    expect(hashState(build(41))).not.toBe(hashState(build(40)));
  });
});
