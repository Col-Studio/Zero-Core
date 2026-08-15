/**
 * The bus is the only channel between the seven modules, so its ordering and isolation
 * guarantees are load-bearing. In particular: emit-during-dispatch must not reorder delivery or
 * recurse (cascades emit from inside listeners constantly), and one module's thrown error must
 * never stop the other six.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ALL_EVENT_TYPES, createEventBus, type EventBus } from '@contracts/events';
import { regionId, speciesId, vec3 } from '@contracts/ids';

const WOLF = speciesId('wolf');
const REGION = regionId('r_0_0');

const died = (entityId: number) =>
  ({
    type: 'creature:died',
    speciesId: WOLF,
    entityId,
    cause: 'player',
    pos: vec3(1, 2, 3),
    regionId: REGION,
  }) as const;

describe('createEventBus', () => {
  let bus: EventBus;
  beforeEach(() => {
    bus = createEventBus();
  });

  it('delivers to subscribers synchronously', () => {
    const seen: number[] = [];
    bus.on('creature:died', (e) => seen.push(e.entityId));
    bus.emit(died(1));
    // No await — if this were async, the simulation would be non-deterministic.
    expect(seen).toEqual([1]);
  });

  it('delivers to multiple listeners in registration order', () => {
    const order: string[] = [];
    bus.on('creature:died', () => order.push('a'));
    bus.on('creature:died', () => order.push('b'));
    bus.on('creature:died', () => order.push('c'));
    bus.emit(died(1));
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('does not deliver to unrelated event types', () => {
    const spy = vi.fn();
    bus.on('creature:born', spy);
    bus.emit(died(1));
    expect(spy).not.toHaveBeenCalled();
  });

  it('stamps the current tick, ignoring any tick on the payload', () => {
    bus.setTick(1234);
    let stamped = -1;
    bus.on('creature:died', (e) => {
      stamped = e.tick;
    });
    bus.emit(died(1));
    expect(stamped).toBe(1234);
    expect(bus.currentTick()).toBe(1234);
  });

  describe('unsubscribe', () => {
    it('stops delivery via the returned disposer', () => {
      const spy = vi.fn();
      const off = bus.on('creature:died', spy);
      bus.emit(died(1));
      off();
      bus.emit(died(2));
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('stops delivery via off()', () => {
      const spy = vi.fn();
      bus.on('creature:died', spy);
      bus.off('creature:died', spy);
      bus.emit(died(1));
      expect(spy).not.toHaveBeenCalled();
    });

    it('is safe to call twice', () => {
      const off = bus.on('creature:died', vi.fn());
      off();
      expect(() => off()).not.toThrow();
    });

    it('survives a listener unsubscribing itself mid-dispatch', () => {
      const calls: string[] = [];
      const off = bus.on('creature:died', () => {
        calls.push('self');
        off();
      });
      bus.on('creature:died', () => calls.push('other'));

      bus.emit(died(1));
      bus.emit(died(2));
      // 'other' must still receive the second event.
      expect(calls).toEqual(['self', 'other', 'other']);
    });
  });

  it('once() delivers exactly one time', () => {
    const spy = vi.fn();
    bus.once('creature:died', spy);
    bus.emit(died(1));
    bus.emit(died(2));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  describe('reentrancy — the cascade case', () => {
    it('defers events emitted inside a listener until the current dispatch finishes', () => {
      const order: string[] = [];

      bus.on('creature:died', () => {
        order.push('died:first');
        // A cascade rule reacting to a death by emitting another event.
        bus.emit({
          type: 'population:changed',
          speciesId: WOLF,
          regionId: REGION,
          count: 3,
          delta: -1,
          normalized: 0.1,
        });
        order.push('died:end');
      });
      bus.on('creature:died', () => order.push('died:second'));
      bus.on('population:changed', () => order.push('population'));

      bus.emit(died(1));

      // The nested emit must NOT interrupt delivery of the first event.
      expect(order).toEqual(['died:first', 'died:end', 'died:second', 'population']);
    });

    it('drains a chain of nested emits in FIFO order without stack recursion', () => {
      const seen: number[] = [];
      bus.on('creature:died', (e) => {
        seen.push(e.entityId);
        if (e.entityId < 50) bus.emit(died(e.entityId + 1));
      });
      expect(() => bus.emit(died(1))).not.toThrow();
      expect(seen).toHaveLength(50);
      expect(seen[0]).toBe(1);
      expect(seen[49]).toBe(50);
    });
  });

  describe('error isolation — one module must not halt the other six', () => {
    it('catches a throwing listener and still delivers to the rest', () => {
      const onError = vi.fn();
      const isolated = createEventBus({ onError });
      const after = vi.fn();

      isolated.on('creature:died', () => {
        throw new Error('module bug');
      }, 'buggy-module');
      isolated.on('creature:died', after, 'healthy-module');

      expect(() => isolated.emit(died(1))).not.toThrow();
      expect(after).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0]?.[2]).toBe('buggy-module');
    });
  });

  describe('onAny', () => {
    it('receives every event type', () => {
      const seen: string[] = [];
      bus.onAny((e) => seen.push(e.type));
      bus.emit(died(1));
      bus.emit({ type: 'ui:toast', text: 'hello', tone: 'info' });
      expect(seen).toEqual(['creature:died', 'ui:toast']);
    });
  });

  describe('event log', () => {
    it('records events with monotonic sequence numbers', () => {
      bus.setTick(5);
      bus.emit(died(1));
      bus.setTick(6);
      bus.emit(died(2));

      const log = bus.log();
      expect(log).toHaveLength(2);
      expect(log[0]?.tick).toBe(5);
      expect(log[1]?.tick).toBe(6);
      expect(log[1]!.seq).toBeGreaterThan(log[0]!.seq);
    });

    it('records events with no listeners — replay must not depend on wiring', () => {
      bus.emit(died(1));
      expect(bus.log()).toHaveLength(1);
    });

    it('filters by tick with logSince', () => {
      bus.setTick(10);
      bus.emit(died(1));
      bus.setTick(20);
      bus.emit(died(2));
      expect(bus.logSince(20)).toHaveLength(1);
      expect(bus.logSince(0)).toHaveLength(2);
    });

    it('keeps the newest entries in order once the ring wraps', () => {
      const small = createEventBus({ logCapacity: 4 });
      for (let i = 1; i <= 10; i++) small.emit(died(i));

      const log = small.log();
      expect(log).toHaveLength(4);
      expect(log.map((e) => (e.event as { entityId: number }).entityId)).toEqual([7, 8, 9, 10]);
    });

    it('can be disabled entirely', () => {
      const silent = createEventBus({ logCapacity: 0 });
      silent.emit(died(1));
      expect(silent.log()).toHaveLength(0);
    });

    it('clears on demand', () => {
      bus.emit(died(1));
      bus.clearLog();
      expect(bus.log()).toHaveLength(0);
    });
  });

  describe('introspection', () => {
    it('counts emits per type', () => {
      bus.emit(died(1));
      bus.emit(died(2));
      bus.emit({ type: 'ui:toast', text: 'x', tone: 'info' });
      expect(bus.stats()['creature:died']).toBe(2);
      expect(bus.stats()['ui:toast']).toBe(1);
    });

    it('reports which types have listeners', () => {
      bus.on('creature:died', vi.fn());
      bus.on('vegetation:changed', vi.fn());
      expect(bus.wiredTypes()).toEqual(['creature:died', 'vegetation:changed']);
    });

    it('drops a type from wiredTypes once its last listener unsubscribes', () => {
      const off = bus.on('creature:died', vi.fn());
      off();
      expect(bus.wiredTypes()).toEqual([]);
    });
  });

  it('reset clears listeners, log, stats, and tick', () => {
    const spy = vi.fn();
    bus.on('creature:died', spy);
    bus.setTick(100);
    bus.emit(died(1));

    bus.reset();
    bus.emit(died(2));

    expect(spy).toHaveBeenCalledTimes(1);
    expect(bus.log()).toHaveLength(1); // only the post-reset emit
    expect(bus.currentTick()).toBe(0);
  });
});

describe('ALL_EVENT_TYPES', () => {
  it('has no duplicates', () => {
    expect(new Set(ALL_EVENT_TYPES).size).toBe(ALL_EVENT_TYPES.length);
  });

  it('covers every namespace the modules rely on', () => {
    const namespaces = new Set(ALL_EVENT_TYPES.map((t) => t.split(':')[0]));
    for (const ns of ['creature', 'population', 'vegetation', 'cascade', 'village', 'mission', 'player', 'boss', 'weather']) {
      expect(namespaces).toContain(ns);
    }
  });
});
