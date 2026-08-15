/**
 * FROZEN — integration lead only. See CLAUDE.md § Frozen files.
 *
 * The typed event bus — the only channel through which the seven modules talk.
 *
 * Design constraints, all of them load-bearing:
 *   • SYNCHRONOUS and ordered. Async delivery would make the simulation non-deterministic.
 *   • Emit-during-dispatch is deferred to a queue, so a listener that emits cannot reorder
 *     delivery or recurse into the current dispatch. Cascades depend on this.
 *   • Listener errors are caught and reported, never propagated. One buggy module must not be
 *     able to halt the simulation of the other six.
 *   • Every event is stamped with the current tick by the bus, not the emitter.
 *   • An optional ring-buffer log powers replay, the debug overlay, and determinism tests.
 */

import type { GameEvent, GameEventType, Listener, Stamped } from './events';
import type { Tick } from './ids';

export interface EventLogEntry {
  tick: Tick;
  /** Monotonic sequence number — total ordering even within one tick. */
  seq: number;
  event: Stamped;
}

export interface EventBusOptions {
  /** Ring-buffer capacity. 0 disables logging (use in perf-sensitive production builds). */
  logCapacity?: number;
  /** Called when a listener throws. Defaults to console.error. */
  onError?: (error: unknown, event: Stamped, listenerName: string) => void;
}

export interface EventBus {
  /** Emit an event. Stamped with the current tick; delivered synchronously unless reentrant. */
  emit<E extends GameEvent>(event: E): void;
  /** Subscribe. Returns an unsubscribe function — always call it on unmount. */
  on<T extends GameEventType>(type: T, listener: Listener<T>, name?: string): () => void;
  /** Subscribe for exactly one delivery. */
  once<T extends GameEventType>(type: T, listener: Listener<T>, name?: string): () => void;
  /** Unsubscribe a listener registered with `on`. */
  off<T extends GameEventType>(type: T, listener: Listener<T>): void;
  /** Subscribe to every event. For the debug overlay and the replay recorder only. */
  onAny(listener: (event: Stamped) => void, name?: string): () => void;

  /** Advance the bus's notion of now. The core loop calls this once per simulation step. */
  setTick(tick: Tick): void;
  currentTick(): Tick;

  /** The event log, oldest first. Empty when logging is disabled. */
  log(): readonly EventLogEntry[];
  /** Events at or after `fromTick`. Used by the chronicle UI and replay. */
  logSince(fromTick: Tick): readonly EventLogEntry[];
  clearLog(): void;

  /** Per-type emit counts. The boundary checker and overlay use this to spot dead wiring. */
  stats(): Readonly<Record<string, number>>;
  /** Which event types currently have at least one listener. */
  wiredTypes(): readonly GameEventType[];

  /** Remove every listener and clear the log. Test teardown. */
  reset(): void;
}

interface Registration {
  fn: (event: Stamped) => void;
  name: string;
  once: boolean;
}

export function createEventBus(options: EventBusOptions = {}): EventBus {
  const logCapacity = options.logCapacity ?? 4096;
  const onError =
    options.onError ??
    ((error, event, name) => {
      console.error(`[bus] listener "${name}" threw on ${event.type}:`, error);
    });

  const listeners = new Map<GameEventType, Registration[]>();
  const anyListeners: Registration[] = [];
  const counts: Record<string, number> = Object.create(null);

  // Ring buffer — fixed allocation, no unbounded growth over a long session.
  const ring: (EventLogEntry | undefined)[] = new Array(logCapacity);
  let ringNext = 0;
  let ringCount = 0;

  let tick: Tick = 0;
  let seq = 0;

  // Reentrancy guard: events emitted *by* a listener queue up and drain after the current
  // dispatch finishes. Keeps delivery order deterministic and prevents stack recursion.
  let dispatching = false;
  const pending: Stamped[] = [];

  const record = (event: Stamped): void => {
    if (logCapacity === 0) return;
    ring[ringNext] = { tick: event.tick, seq: seq++, event };
    ringNext = (ringNext + 1) % logCapacity;
    if (ringCount < logCapacity) ringCount++;
  };

  const deliver = (event: Stamped): void => {
    const registrations = listeners.get(event.type);

    if (registrations !== undefined && registrations.length > 0) {
      // Copy: a listener may unsubscribe itself or others mid-dispatch.
      const snapshot = registrations.slice();
      let hasOnce = false;
      for (const reg of snapshot) {
        if (reg.once) hasOnce = true;
        try {
          reg.fn(event);
        } catch (error) {
          onError(error, event, reg.name);
        }
      }
      if (hasOnce) {
        listeners.set(
          event.type,
          registrations.filter((reg) => !reg.once),
        );
      }
    }

    if (anyListeners.length > 0) {
      for (const reg of anyListeners.slice()) {
        try {
          reg.fn(event);
        } catch (error) {
          onError(error, event, reg.name);
        }
      }
    }
  };

  const bus: EventBus = {
    emit(event) {
      const stamped = { ...event, tick } as Stamped;
      counts[event.type] = (counts[event.type] ?? 0) + 1;
      record(stamped);

      if (dispatching) {
        pending.push(stamped);
        return;
      }

      dispatching = true;
      try {
        deliver(stamped);
        // Drain anything listeners emitted, in FIFO order.
        while (pending.length > 0) {
          deliver(pending.shift()!);
        }
      } finally {
        dispatching = false;
        pending.length = 0;
      }
    },

    on(type, listener, name = 'anonymous') {
      const reg: Registration = {
        fn: listener as (event: Stamped) => void,
        name,
        once: false,
      };
      const existing = listeners.get(type);
      if (existing === undefined) listeners.set(type, [reg]);
      else existing.push(reg);
      return () => {
        const list = listeners.get(type);
        if (list === undefined) return;
        const index = list.indexOf(reg);
        if (index >= 0) list.splice(index, 1);
      };
    },

    once(type, listener, name = 'anonymous') {
      const reg: Registration = {
        fn: listener as (event: Stamped) => void,
        name,
        once: true,
      };
      const existing = listeners.get(type);
      if (existing === undefined) listeners.set(type, [reg]);
      else existing.push(reg);
      return () => {
        const list = listeners.get(type);
        if (list === undefined) return;
        const index = list.indexOf(reg);
        if (index >= 0) list.splice(index, 1);
      };
    },

    off(type, listener) {
      const list = listeners.get(type);
      if (list === undefined) return;
      const index = list.findIndex((reg) => reg.fn === listener);
      if (index >= 0) list.splice(index, 1);
    },

    onAny(listener, name = 'anonymous') {
      const reg: Registration = { fn: listener, name, once: false };
      anyListeners.push(reg);
      return () => {
        const index = anyListeners.indexOf(reg);
        if (index >= 0) anyListeners.splice(index, 1);
      };
    },

    setTick(next) {
      tick = next;
    },

    currentTick() {
      return tick;
    },

    log() {
      if (ringCount === 0) return [];
      const out: EventLogEntry[] = [];
      // Oldest first: start at the write head when the buffer has wrapped.
      const start = ringCount === logCapacity ? ringNext : 0;
      for (let i = 0; i < ringCount; i++) {
        const entry = ring[(start + i) % logCapacity];
        if (entry !== undefined) out.push(entry);
      }
      return out;
    },

    logSince(fromTick) {
      return bus.log().filter((entry) => entry.tick >= fromTick);
    },

    clearLog() {
      ring.fill(undefined);
      ringNext = 0;
      ringCount = 0;
    },

    stats() {
      return { ...counts };
    },

    wiredTypes() {
      const out: GameEventType[] = [];
      for (const [type, list] of listeners) {
        if (list.length > 0) out.push(type);
      }
      return out.sort();
    },

    reset() {
      listeners.clear();
      anyListeners.length = 0;
      pending.length = 0;
      for (const key of Object.keys(counts)) delete counts[key];
      bus.clearLog();
      tick = 0;
      seq = 0;
      dispatching = false;
    },
  };

  return bus;
}
