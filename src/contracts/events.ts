/**
 * FROZEN — integration lead only. See CLAUDE.md § Frozen files.
 *
 * The event vocabulary. This file is the single most important contract in the project: seven
 * isolated modules never import each other, so *every* cross-module fact travels as one of the
 * events below. If it isn't here, it cannot be communicated.
 *
 * The interfaces are grouped by owning module under `./events/`; this file is the barrel plus the
 * union, and it is the only import path you need:
 *
 *   import { createEventBus, type CreatureDied } from '@contracts/events';
 *
 * Rules for emitters:
 *   • Events are facts about the past, not requests ("creature:died", not "killCreature") —
 *     except the explicit `*:request` events aimed at `presentation`.
 *   • Emit from the module that OWNS the fact. `ecology` owns population numbers; `creatures`
 *     owns bodies. Never emit on another module's behalf.
 *   • Payloads are plain serializable data — they go into the replay log.
 *   • `tick` is stamped by the bus, never by the emitter.
 */

import type { Tick } from './ids';
import type { CreatureEvent } from './events/creatures';
import type { EcologyEvent } from './events/ecology';
import type { WorldEvent } from './events/world';
import type { SocietyEvent } from './events/society';
import type { PlayerEvent, PresentationEvent } from './events/player';

export type * from './events/creatures';
export type * from './events/ecology';
export type * from './events/world';
export type * from './events/society';
export type * from './events/player';

// -------------------------------------------------------------------------------------------
// Union + helpers
// -------------------------------------------------------------------------------------------

/** Every event in the game. Discriminated on `type`. */
export type GameEvent =
  | CreatureEvent
  | EcologyEvent
  | WorldEvent
  | SocietyEvent
  | PlayerEvent
  | PresentationEvent;

export type GameEventType = GameEvent['type'];

/** Narrow the union by tag: `EventOf<'creature:died'>` is `CreatureDied`. */
export type EventOf<T extends GameEventType> = Extract<GameEvent, { type: T }>;

/** What a listener receives: the event plus the tick the bus stamped on it. */
export type Stamped<E extends GameEvent = GameEvent> = E & { readonly tick: Tick };

export type Listener<T extends GameEventType> = (event: Stamped<EventOf<T>>) => void;

/**
 * Every event type, as a runtime array. `scripts/check-boundaries.mjs` reads this to detect
 * orphaned events (declared but never emitted, or emitted with no listener) — the failure mode
 * that breaks a bus architecture *silently*. Keep in sync with the union above; the type test
 * below fails to compile if they drift.
 */
export const ALL_EVENT_TYPES = [
  'creature:died',
  'creature:born',
  'creature:stateChanged',
  'population:changed',
  'vegetation:changed',
  'cascade:triggered',
  'species:migrating',
  'species:extinct',
  'resource:depleted',
  'resource:restored',
  'weather:changed',
  'time:phase',
  'region:discovered',
  'village:economyChanged',
  'village:needChanged',
  'faction:relationChanged',
  'mission:offered',
  'mission:accepted',
  'mission:completed',
  'mission:failed',
  'player:attacked',
  'player:damaged',
  'player:died',
  'player:styleChanged',
  'player:regionChanged',
  'player:harvested',
  'boss:phaseChanged',
  'boss:defeated',
  'vfx:request',
  'sfx:request',
  'ui:toast',
] as const satisfies readonly GameEventType[];

// Compile-time completeness check. `satisfies` above proves every listed string is a real event
// type; this proves the converse — that none is MISSING from the list. If you add an event to the
// union and forget the array, this line fails to compile. Zero runtime cost.
type AssertNever<T extends never> = T;
export type EventListIsComplete = AssertNever<
  Exclude<GameEventType, (typeof ALL_EVENT_TYPES)[number]>
>;

export { createEventBus, type EventBus, type EventLogEntry } from './bus';
