/**
 * The ECS world: entities, component stores, and the bitmask index that joins them.
 *
 * No third-party ECS (CLAUDE.md § Stack). The whole thing is ~250 lines because the design is
 * deliberately unfashionable: no archetypes, no chunk migration, just a component bitmask per
 * entity slot and a linear scan for queries. At the scale this game runs (10k entities, 20 Hz)
 * a scan over a `Uint32Array` is memory-bandwidth-bound and measures faster than archetype
 * bookkeeping — and it never surprises anyone with a re-archetyping stall mid-cascade.
 */

import type { EntityId } from '@contracts/ids';
import { hashState } from '@contracts/rng';
import { ECS } from '../core.data';
import { EntityManager, entityIndex, type EntitySnapshot } from './entity';
import type { ComponentStore } from './store';

const WORDS = ECS.maskWords;
export const MAX_COMPONENTS = WORDS * 32;

/** Typed handle returned by `defineComponent`. Modules keep this, never the numeric id. */
export interface Component<TRow, TStore extends ComponentStore<TRow> = ComponentStore<TRow>> {
  readonly id: number;
  readonly name: string;
  readonly store: TStore;
  /** Which mask word this component lives in. */
  readonly word: number;
  readonly bit: number;
}

/** Any component, whatever its row type — the shape queries and snapshots work in. */
export type AnyComponent = Component<any, ComponentStore<any>>;

export interface QuerySpec {
  /** Entity must have all of these. */
  all?: readonly AnyComponent[];
  /** Entity must have none of these. */
  none?: readonly AnyComponent[];
}

export interface Query {
  /** Iterate live matching entities. `index` is the component-array slot; `id` is the handle. */
  forEach(visit: (index: number, id: EntityId) => void): void;
  count(): number;
  /** Materialised ids. Allocates — never call this from a system's update. */
  ids(): EntityId[];
  first(): EntityId | null;
}

export interface EcsSnapshot {
  used: number;
  entities: EntitySnapshot;
  /** Component masks, one row of `WORDS` numbers per used slot, flattened. */
  masks: number[];
  /** Per component name: `[slotIndex, row]` pairs for entities that have it. */
  components: Record<string, [number, unknown][]>;
}

export class EcsWorld {
  readonly entities: EntityManager;

  private components: AnyComponent[] = [];
  private byName = new Map<string, AnyComponent>();
  private masks: Uint32Array;
  private slotCapacity: number;

  constructor(capacity: number = ECS.initialCapacity) {
    this.slotCapacity = capacity;
    this.masks = new Uint32Array(capacity * WORDS);
    this.entities = new EntityManager(capacity, (next) => this.grow(next));
  }

  // ----------------------------------------------------------------------------- components

  defineComponent<TRow, TStore extends ComponentStore<TRow>>(store: TStore): Component<TRow, TStore> {
    if (this.byName.has(store.name)) {
      throw new Error(`ecs: component '${store.name}' is already defined`);
    }
    const id = this.components.length;
    if (id >= MAX_COMPONENTS) {
      throw new Error(
        `ecs: more than ${MAX_COMPONENTS} components. Raise ECS.maskWords in core.data.ts.`,
      );
    }
    store.ensureCapacity(this.slotCapacity);
    const component: Component<TRow, TStore> = {
      id,
      name: store.name,
      store,
      word: id >>> 5,
      bit: 1 << (id & 31),
    };
    this.components.push(component);
    this.byName.set(store.name, component);
    return component;
  }

  component(name: string): AnyComponent | undefined {
    return this.byName.get(name);
  }

  /** Defined component names, in definition order. The overlay lists these. */
  componentNames(): string[] {
    return this.components.map((component) => component.name);
  }

  /** Allocated slots. Renderers size their instance buffers from this. */
  get capacity(): number {
    return this.slotCapacity;
  }

  /**
   * Exclusive upper bound for a direct scan over the component arrays. Renderers walk
   * `0..slotCount` and skip dead slots rather than materialising an id array every frame.
   */
  get slotCount(): number {
    return this.entities.used;
  }

  isSlotAlive(index: number): boolean {
    return this.entities.isSlotAlive(index);
  }

  // ----------------------------------------------------------------------------- entities

  create(): EntityId {
    const id = this.entities.create();
    const index = entityIndex(id);
    for (let w = 0; w < WORDS; w++) this.masks[index * WORDS + w] = 0;
    return id;
  }

  /** Create with components in one call: `spawn([pos, { x: 1 }], [vel, { dx: 0 }])`. */
  spawn(...parts: [AnyComponent, Record<string, unknown>?][]): EntityId {
    const id = this.create();
    for (const [component, value] of parts) this.add(id, component, value as never);
    return id;
  }

  destroy(id: EntityId): boolean {
    if (!this.entities.isAlive(id)) return false;
    const index = entityIndex(id);
    for (const component of this.components) {
      if ((this.masks[index * WORDS + component.word]! & component.bit) !== 0) {
        component.store.reset(index);
      }
    }
    for (let w = 0; w < WORDS; w++) this.masks[index * WORDS + w] = 0;
    return this.entities.destroy(id);
  }

  isAlive(id: EntityId): boolean {
    return this.entities.isAlive(id);
  }

  get count(): number {
    return this.entities.count;
  }

  // ----------------------------------------------------------------------------- component ops

  add<TRow>(id: EntityId, component: Component<TRow, ComponentStore<TRow>>, value?: Partial<TRow>): void {
    if (!this.entities.isAlive(id)) return;
    const index = entityIndex(id);
    this.masks[index * WORDS + component.word]! |= component.bit;
    if (value !== undefined) component.store.write(index, value);
  }

  remove(id: EntityId, component: AnyComponent): void {
    if (!this.entities.isAlive(id)) return;
    const index = entityIndex(id);
    if ((this.masks[index * WORDS + component.word]! & component.bit) === 0) return;
    this.masks[index * WORDS + component.word]! &= ~component.bit;
    component.store.reset(index);
  }

  has(id: EntityId, component: AnyComponent): boolean {
    if (!this.entities.isAlive(id)) return false;
    return (this.masks[entityIndex(id) * WORDS + component.word]! & component.bit) !== 0;
  }

  /** Copy of the component row, or null. Allocates — hot systems use `component.store.field`. */
  get<TRow>(id: EntityId, component: Component<TRow, ComponentStore<TRow>>): TRow | null {
    if (!this.has(id, component)) return null;
    return component.store.read(entityIndex(id));
  }

  set<TRow>(id: EntityId, component: Component<TRow, ComponentStore<TRow>>, value: Partial<TRow>): void {
    if (!this.has(id, component)) return;
    component.store.write(entityIndex(id), value);
  }

  /** Slot index for direct typed-array access. -1 when the id is stale. */
  indexOf(id: EntityId): number {
    return this.entities.isAlive(id) ? entityIndex(id) : -1;
  }

  // ----------------------------------------------------------------------------- queries

  query(spec: QuerySpec): Query {
    const all = new Uint32Array(WORDS);
    const none = new Uint32Array(WORDS);
    for (const component of spec.all ?? []) all[component.word]! |= component.bit;
    for (const component of spec.none ?? []) none[component.word]! |= component.bit;

    const matches = (index: number): boolean => {
      const base = index * WORDS;
      for (let w = 0; w < WORDS; w++) {
        const mask = this.masks[base + w]!;
        if ((mask & all[w]!) !== all[w]!) return false;
        if ((mask & none[w]!) !== 0) return false;
      }
      return true;
    };

    const world = this;
    return {
      forEach(visit) {
        const used = world.entities.used;
        for (let index = 0; index < used; index++) {
          if (!world.entities.isSlotAlive(index)) continue;
          if (!matches(index)) continue;
          visit(index, world.entities.idAt(index));
        }
      },
      count() {
        let total = 0;
        const used = world.entities.used;
        for (let index = 0; index < used; index++) {
          if (world.entities.isSlotAlive(index) && matches(index)) total++;
        }
        return total;
      },
      ids() {
        const out: EntityId[] = [];
        this.forEach((_, id) => out.push(id));
        return out;
      },
      first() {
        const used = world.entities.used;
        for (let index = 0; index < used; index++) {
          if (world.entities.isSlotAlive(index) && matches(index)) return world.entities.idAt(index);
        }
        return null;
      },
    };
  }

  // ----------------------------------------------------------------------------- persistence

  snapshot(): EcsSnapshot {
    const used = this.entities.used;
    const masks: number[] = [];
    for (let i = 0; i < used * WORDS; i++) masks.push(this.masks[i]!);

    const components: Record<string, [number, unknown][]> = {};
    for (const component of this.components) {
      const rows: [number, unknown][] = [];
      for (let index = 0; index < used; index++) {
        if (!this.entities.isSlotAlive(index)) continue;
        if ((this.masks[index * WORDS + component.word]! & component.bit) === 0) continue;
        rows.push([index, component.store.read(index)]);
      }
      components[component.name] = rows;
    }

    return { used, entities: this.entities.snapshot(), masks, components };
  }

  /**
   * Restore in place. Component *definitions* are not serialized — the caller must have defined
   * the same components before restoring, which is exactly what happens when a save is loaded
   * into a freshly constructed world. Unknown component names in the save are ignored and
   * reported, so an old save opened by a newer build degrades instead of throwing.
   */
  restore(snapshot: EcsSnapshot): { ignored: string[] } {
    this.reserve(snapshot.entities.capacity);
    for (const component of this.components) {
      for (let index = 0; index < this.slotCapacity; index++) component.store.reset(index);
    }
    this.masks.fill(0);
    this.entities.restore(snapshot.entities);

    for (let i = 0; i < snapshot.masks.length && i < this.masks.length; i++) {
      this.masks[i] = snapshot.masks[i]! >>> 0;
    }

    const ignored: string[] = [];
    for (const [name, rows] of Object.entries(snapshot.components)) {
      const component = this.byName.get(name);
      if (component === undefined) {
        ignored.push(name);
        continue;
      }
      for (const [index, row] of rows) component.store.write(index, row as never);
    }
    return { ignored };
  }

  /**
   * Structural hash of every live entity and component. This is the determinism assertion the
   * whole project rests on: same seed + same tick ⇒ same string, here and after a save/load.
   */
  hash(): string {
    const used = this.entities.used;
    const rows: unknown[] = [];
    for (let index = 0; index < used; index++) {
      if (!this.entities.isSlotAlive(index)) continue;
      const row: unknown[] = [index];
      for (const component of this.components) {
        if ((this.masks[index * WORDS + component.word]! & component.bit) === 0) continue;
        row.push(component.name, component.store.read(index));
      }
      rows.push(row);
    }
    return hashState(rows);
  }

  clear(): void {
    this.entities.clear();
    this.masks.fill(0);
    for (const component of this.components) {
      for (let index = 0; index < this.slotCapacity; index++) component.store.reset(index);
    }
  }

  private reserve(capacity: number): void {
    if (capacity <= this.slotCapacity) return;
    let next = this.slotCapacity;
    while (next < capacity) next *= ECS.growthFactor;
    this.entities.reserve(next);
    this.grow(next);
  }

  private grow(capacity: number): void {
    if (capacity <= this.slotCapacity) return;
    const masks = new Uint32Array(capacity * WORDS);
    masks.set(this.masks);
    this.masks = masks;
    this.slotCapacity = capacity;
    for (const component of this.components) component.store.ensureCapacity(capacity);
  }
}
