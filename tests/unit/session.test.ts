/**
 * Session params and the readiness flag. Small surface, but every module's dev harness and the
 * screenshot script depend on it: if `?tick=` is mis-parsed, six people's screenshots are taken at
 * the wrong simulation time and nobody notices, and if `markReady()` doesn't fire, `shot.mjs`
 * silently falls back to a fixed delay and captures half-loaded scenes.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { markReady, parseSessionParams } from '@contracts/index';

describe('parseSessionParams', () => {
  it('defaults to seed 42, no scene, tick 0, unfrozen', () => {
    expect(parseSessionParams('')).toEqual({ seed: 42, scene: null, tick: 0, freeze: false });
  });

  it('parses a full debug-scene URL', () => {
    expect(parseSessionParams('?seed=7&scene=terrain&tick=2000&freeze=1')).toEqual({
      seed: 7,
      scene: 'terrain',
      tick: 2000,
      freeze: true,
    });
  });

  it('works with or without the leading question mark', () => {
    expect(parseSessionParams('seed=9')).toEqual(parseSessionParams('?seed=9'));
  });

  it('accepts freeze=true as well as freeze=1, and nothing else', () => {
    expect(parseSessionParams('?freeze=true').freeze).toBe(true);
    expect(parseSessionParams('?freeze=1').freeze).toBe(true);
    expect(parseSessionParams('?freeze=0').freeze).toBe(false);
    expect(parseSessionParams('?freeze=yes').freeze).toBe(false);
  });

  it('falls back to the default seed on garbage rather than producing NaN', () => {
    // A NaN seed would make createRng return a fixed degenerate stream — silently killing
    // every module's determinism test with no error message.
    for (const bad of ['?seed=abc', '?seed=', '?seed=NaN', '?seed=Infinity']) {
      const { seed } = parseSessionParams(bad);
      expect(Number.isFinite(seed)).toBe(true);
      expect(seed).toBe(42);
    }
  });

  it('truncates fractional seeds and ticks to integers', () => {
    expect(parseSessionParams('?seed=7.9&tick=100.6')).toMatchObject({ seed: 7, tick: 100 });
  });

  it('accepts negative seeds but never a negative tick', () => {
    expect(parseSessionParams('?seed=-5').seed).toBe(-5);
    expect(parseSessionParams('?tick=-100').tick).toBe(0);
  });

  it('clamps a non-numeric tick to 0 instead of fast-forwarding forever', () => {
    expect(parseSessionParams('?tick=soon').tick).toBe(0);
    expect(parseSessionParams('?tick=Infinity').tick).toBe(0);
  });

  it('ignores unknown params', () => {
    expect(parseSessionParams('?seed=3&sunshine=lots').seed).toBe(3);
  });

  it('keeps an empty scene name as null, not an empty string', () => {
    // `scene=` with no value would otherwise select a scene named '' in every module's switch.
    expect(parseSessionParams('?scene=').scene).toBeNull();
    expect(parseSessionParams('?scene=%20%20').scene).toBeNull();
    expect(parseSessionParams('').scene).toBeNull();
  });
});

describe('markReady', () => {
  const globalWithWindow = globalThis as { window?: unknown };

  afterEach(() => {
    delete globalWithWindow.window;
    vi.unstubAllGlobals();
  });

  it('sets window.__READY__ so the screenshot harness stops waiting', () => {
    const fakeWindow: Record<string, unknown> = {};
    vi.stubGlobal('window', fakeWindow);
    markReady();
    expect(fakeWindow.__READY__).toBe(true);
  });

  it('is a no-op headlessly — unit tests import module code with no DOM', () => {
    expect(globalWithWindow.window).toBeUndefined();
    expect(() => markReady()).not.toThrow();
  });

  it('is idempotent', () => {
    const fakeWindow: Record<string, unknown> = {};
    vi.stubGlobal('window', fakeWindow);
    markReady();
    markReady();
    expect(fakeWindow.__READY__).toBe(true);
  });
});
