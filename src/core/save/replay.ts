/**
 * Deterministic replay: seed + input log ⇒ the same world, tick for tick.
 *
 * ## What gets recorded, and why it is not everything
 *
 * A simulation this size emits thousands of events per minute, and almost all of them are
 * *consequences* — `population:changed` follows from the rules, given the same state. Recording
 * and re-emitting those during a replay would apply every effect twice.
 *
 * So the recorder keeps only INPUT: events that enter the simulation from outside it, which in
 * practice means the player. Everything else is reproduced by re-running the same systems with
 * the same seed. That is also the honest test of determinism — if a replay diverges, some system
 * is reading something it shouldn't (a clock, `Math.random`, iteration order of a `Set`), and the
 * replay hash says so on the exact tick it happened.
 */

import type { EventBus, GameEventType, Stamped } from '@contracts/events';
import type { Tick } from '@contracts/ids';
import type { RecordedEvent } from './format';

/**
 * Events that originate outside the simulation. Everything the player does, plus the two
 * `presentation` requests that a scripted demo might inject.
 */
export const DEFAULT_INPUT_EVENTS: readonly GameEventType[] = [
  'player:attacked',
  'player:damaged',
  'player:styleChanged',
  'player:harvested',
  'mission:accepted',
];

export interface Recorder {
  events(): readonly RecordedEvent[];
  since(tick: Tick): readonly RecordedEvent[];
  count(): number;
  clear(): void;
  /** Stop recording. Always call this on unmount. */
  dispose(): void;
}

export interface RecorderOptions {
  /** Which event types count as input. Defaults to `DEFAULT_INPUT_EVENTS`. */
  inputTypes?: readonly GameEventType[];
  /** Ring capacity. Older entries are dropped once full. */
  capacity?: number;
}

export function createRecorder(bus: EventBus, options: RecorderOptions = {}): Recorder {
  const types = new Set<string>(options.inputTypes ?? DEFAULT_INPUT_EVENTS);
  const capacity = options.capacity ?? 8192;
  const log: RecordedEvent[] = [];
  let seq = 0;

  const unsubscribe = bus.onAny((event: Stamped) => {
    if (!types.has(event.type)) return;
    log.push({ tick: event.tick, seq: seq++, event: { ...event } as RecordedEvent['event'] });
    if (log.length > capacity) log.shift();
  }, 'core.recorder');

  return {
    events: () => log,
    since: (tick) => log.filter((entry) => entry.tick >= tick),
    count: () => log.length,
    clear() {
      log.length = 0;
      seq = 0;
    },
    dispose: unsubscribe,
  };
}

export interface ReplayOptions {
  bus: EventBus;
  events: readonly RecordedEvent[];
  /** Run one simulation step. Usually `loop.runTicks(1)`. */
  step: (tick: Tick) => void;
  /** Tick to start from — the tick of the snapshot the replay was seeded with. */
  fromTick: Tick;
  /** Tick to stop at, exclusive. */
  toTick: Tick;
  /** Optional per-tick observer, for a progress bar or a divergence bisect. */
  onTick?: (tick: Tick) => void;
}

/**
 * Re-run the simulation from `fromTick` to `toTick`, injecting recorded input at the exact tick
 * it was recorded on and in the exact order it was recorded in.
 *
 * Ordering matters as much as timing: two attacks on the same tick, applied in the other order,
 * can kill a different creature and fork the world from there. `seq` preserves it.
 */
export function replay(options: ReplayOptions): number {
  const byTick = new Map<Tick, RecordedEvent[]>();
  for (const entry of [...options.events].sort((a, b) => a.tick - b.tick || a.seq - b.seq)) {
    const bucket = byTick.get(entry.tick);
    if (bucket === undefined) byTick.set(entry.tick, [entry]);
    else bucket.push(entry);
  }

  let injected = 0;
  for (let tick = options.fromTick; tick < options.toTick; tick++) {
    options.bus.setTick(tick);
    const bucket = byTick.get(tick);
    if (bucket !== undefined) {
      for (const entry of bucket) {
        // Cast: the log is plain data by construction, and the bus re-stamps the tick itself.
        options.bus.emit(entry.event as never);
        injected++;
      }
    }
    options.step(tick);
    options.onTick?.(tick);
  }
  return injected;
}
