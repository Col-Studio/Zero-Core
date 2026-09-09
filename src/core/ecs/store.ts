/**
 * Component storage.
 *
 * Two shapes, chosen per component by how hot it is:
 *
 *   • `soa()`  — struct-of-arrays over typed arrays. One `Float32Array` per field, indexed by
 *     entity index. This is what lets a movement system over 10 000 entities be a tight numeric
 *     loop with zero allocation and zero property lookups, which is the difference between
 *     hitting 20 Hz with room to spare and not.
 *   • `objects()` — a plain array of objects, for cold or variable-shaped data (a name, a state
 *     machine, a mission reference). Never touch these in a per-entity hot loop.
 *
 * Both implement `ComponentStore` so the world can grow, reset, snapshot, and restore them
 * uniformly — which is what makes save/load work for components core has never heard of.
 */

export type FieldType = 'f32' | 'f64' | 'i32' | 'u32' | 'u16' | 'u8';

export type NumericArray = Float32Array | Float64Array | Int32Array | Uint32Array | Uint16Array | Uint8Array;

export type SoaSchema = Readonly<Record<string, FieldType>>;

/** Row view of a SoA component: `{ x: number, y: number }` for `{ x: 'f32', y: 'f32' }`. */
export type SoaRow<S extends SoaSchema> = { [K in keyof S]: number };

const ARRAY_BY_TYPE: Record<FieldType, (n: number) => NumericArray> = {
  f32: (n) => new Float32Array(n),
  f64: (n) => new Float64Array(n),
  i32: (n) => new Int32Array(n),
  u32: (n) => new Uint32Array(n),
  u16: (n) => new Uint16Array(n),
  u8: (n) => new Uint8Array(n),
};

/**
 * What the world needs from any component store. Deliberately tiny: modules add stores of their
 * own by implementing this, without core knowing their shape.
 */
export interface ComponentStore<TRow = unknown> {
  readonly name: string;
  /** Grow backing storage to `capacity` slots. Must preserve existing data. */
  ensureCapacity(capacity: number): void;
  /** Zero the slot. Called on component removal and entity destruction. */
  reset(index: number): void;
  /** Plain serializable copy of one slot. */
  read(index: number): TRow;
  /** Write one slot. Missing fields keep their current value. */
  write(index: number, value: Partial<TRow>): void;
}

export interface SoaStore<S extends SoaSchema> extends ComponentStore<SoaRow<S>> {
  readonly schema: S;
  /** The raw typed arrays. Hot systems index these directly: `pos.field.x[i]`. */
  readonly field: { [K in keyof S]: NumericArray };
  /** Field-wise dump of the first `used` slots, for snapshots. */
  dump(used: number): Record<string, number[]>;
  load(data: Record<string, readonly number[]>): void;
}

export function soa<const S extends SoaSchema>(
  name: string,
  schema: S,
  capacity: number,
): SoaStore<S> {
  const keys = Object.keys(schema) as (keyof S & string)[];
  const field = {} as { [K in keyof S]: NumericArray };
  for (const key of keys) field[key] = ARRAY_BY_TYPE[schema[key]!](capacity);

  let size = capacity;

  return {
    name,
    schema,
    field,

    ensureCapacity(next) {
      if (next <= size) return;
      for (const key of keys) {
        const grown = ARRAY_BY_TYPE[schema[key]!](next);
        grown.set(field[key] as unknown as ArrayLike<number> & NumericArray);
        field[key] = grown;
      }
      size = next;
    },

    reset(index) {
      for (const key of keys) field[key]![index] = 0;
    },

    read(index) {
      const row = {} as SoaRow<S>;
      for (const key of keys) row[key] = field[key]![index]!;
      return row;
    },

    write(index, value) {
      for (const key of keys) {
        const next = (value as Record<string, number | undefined>)[key];
        if (next !== undefined) field[key]![index] = next;
      }
    },

    dump(used) {
      const out: Record<string, number[]> = {};
      for (const key of keys) out[key] = Array.from(field[key]!.subarray(0, used));
      return out;
    },

    load(data) {
      for (const key of keys) {
        const values = data[key];
        if (values === undefined) continue;
        this.ensureCapacity(values.length);
        const target = field[key]!;
        for (let i = 0; i < values.length; i++) target[i] = values[i]!;
      }
    },
  };
}

export interface ObjectStore<T extends object> extends ComponentStore<T> {
  /** Slot access without copying. `undefined` when the entity does not have the component. */
  at(index: number): T | undefined;
  /** Raw backing array, for snapshots. */
  readonly slots: (T | undefined)[];
}

export function objects<T extends object>(
  name: string,
  makeDefault: () => T,
  capacity: number,
): ObjectStore<T> {
  const slots: (T | undefined)[] = new Array<T | undefined>(capacity).fill(undefined);

  return {
    name,
    slots,

    ensureCapacity(next) {
      while (slots.length < next) slots.push(undefined);
    },

    reset(index) {
      slots[index] = undefined;
    },

    at(index) {
      return slots[index];
    },

    read(index) {
      const current = slots[index];
      // Copy so callers cannot mutate simulation state through a snapshot.
      return current === undefined ? makeDefault() : { ...current };
    },

    write(index, value) {
      const current = slots[index] ?? makeDefault();
      slots[index] = { ...current, ...value };
    },
  };
}
