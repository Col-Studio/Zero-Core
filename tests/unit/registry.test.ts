/**
 * The registry is where Null services become real ones, one at a time, during the merge. Every
 * behaviour tested here is a merge-day safety property:
 *
 *   • lazy resolution — a module that mounted against a Null must see the real service after
 *     the swap, or the merge silently does nothing and the real module "doesn't work"
 *   • per-service independence — so the lead can register `world`, verify, commit, then continue
 *   • the Null-access warning — the visible signal that a swap was forgotten
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServiceRegistry, type ServiceName } from '@contracts/registry';
import { createNullWorldQuery } from '@contracts/nulls';
import type { Tick } from '@contracts/ids';

const ALL: ServiceName[] = ['world', 'ecology', 'creatures', 'player', 'society', 'presentation'];

const fakeWorld = (height: number) => ({ ...createNullWorldQuery(), getHeightAt: () => height });

describe('createServiceRegistry', () => {
  let info: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exposes all six accessors, each returning a working Null by default', () => {
    const registry = createServiceRegistry({ warnOnNullAccess: false });
    for (const name of ALL) {
      expect(typeof registry[name]).toBe('function');
      expect(registry[name]()).toBeDefined();
    }
  });

  it('threads getTick into the Nulls so they animate with the sim', () => {
    let tick: Tick = 0;
    const registry = createServiceRegistry({ getTick: () => tick, warnOnNullAccess: false });
    const start = registry.player().getPosition();
    tick = 1200;
    expect(registry.player().getPosition()).not.toEqual(start);
  });

  it('defaults to a frozen tick 0 when no tick source is given', () => {
    const a = createServiceRegistry({ warnOnNullAccess: false });
    const b = createServiceRegistry({ warnOnNullAccess: false });
    expect(a.player().getPosition()).toEqual(b.player().getPosition());
  });

  describe('the Null-access warning', () => {
    it('fires once per service, not once per read', () => {
      const registry = createServiceRegistry();
      registry.world();
      registry.world();
      registry.world();
      expect(info).toHaveBeenCalledTimes(1);
      expect(String(info.mock.calls[0]?.[0])).toContain('world');
    });

    it('warns separately for each service', () => {
      const registry = createServiceRegistry();
      registry.world();
      registry.ecology();
      expect(info).toHaveBeenCalledTimes(2);
    });

    it('goes quiet once a real implementation is registered', () => {
      const registry = createServiceRegistry();
      registry.register('world', fakeWorld(1));
      registry.world();
      registry.world();
      expect(info).not.toHaveBeenCalled();
    });

    it('re-arms after unregister, so a bisect is not silent', () => {
      const registry = createServiceRegistry();
      registry.register('world', fakeWorld(1));
      registry.world();
      registry.unregister('world');
      registry.world();
      expect(info).toHaveBeenCalledTimes(1);
    });

    it('can be suppressed for tests', () => {
      createServiceRegistry({ warnOnNullAccess: false }).world();
      expect(info).not.toHaveBeenCalled();
    });
  });

  it('warns loudly on a double register — two branches claiming one service', () => {
    const registry = createServiceRegistry({ warnOnNullAccess: false });
    registry.register('world', fakeWorld(1));
    registry.register('world', fakeWorld(2));
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain('re-registered');
    // Last write wins.
    expect(registry.world().getHeightAt(0, 0)).toBe(2);
  });

  it('unregistering a service that was never registered is a no-op', () => {
    const registry = createServiceRegistry({ warnOnNullAccess: false });
    expect(() => registry.unregister('society')).not.toThrow();
    expect(registry.isReal('society')).toBe(false);
  });

  it('tracks isReal and status per service through the whole merge', () => {
    const registry = createServiceRegistry({ warnOnNullAccess: false });
    expect(Object.values(registry.status()).every((s) => s === 'null')).toBe(true);

    // Merge order from CLAUDE.md — register one at a time, as the lead actually will.
    const order: ServiceName[] = ['world', 'ecology', 'creatures', 'society', 'player', 'presentation'];
    order.forEach((name, i) => {
      registry.register(name, registry[name]() as never);
      expect(registry.isReal(name)).toBe(true);
      const real = Object.values(registry.status()).filter((s) => s === 'real').length;
      expect(real).toBe(i + 1);
    });
  });

  it('reset returns every service to its Null', () => {
    const registry = createServiceRegistry({ warnOnNullAccess: false });
    for (const name of ALL) registry.register(name, registry[name]() as never);
    registry.reset();

    expect(Object.values(registry.status()).every((s) => s === 'null')).toBe(true);
    for (const name of ALL) expect(registry.isReal(name)).toBe(false);
  });

  it('status is a snapshot, not a live view', () => {
    const registry = createServiceRegistry({ warnOnNullAccess: false });
    const before = registry.status();
    registry.register('world', fakeWorld(1));
    expect(before.world).toBe('null');
    expect(registry.status().world).toBe('real');
  });
});
