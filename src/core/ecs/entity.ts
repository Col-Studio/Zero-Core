/**
 * Entity allocation.
 *
 * Ids are plain numbers (`EntityId` in `@contracts/ids`) so they can sit in typed arrays and be
 * compared without allocation. An id packs two things:
 *
 *     [ generation : 11 bits ][ index : 20 bits ]
 *
 * The index is the slot in every component array — that is what makes component lookup a single
 * array read. The generation is bumped when a slot is recycled, so a stale id kept by another
 * module (a mission that remembers the wolf it was about, say) is *detectably* stale instead of
 * silently pointing at whatever creature took the slot. That confusion is nearly impossible to
 * debug across seven modules, which is why the generation is worth 11 bits.
 */

import { NO_ENTITY, type EntityId } from '@contracts/ids';
import { ECS } from '../core.data';

const INDEX_BITS = ECS.indexBits;
const INDEX_MASK = (1 << INDEX_BITS) - 1;

/** Highest addressable slot count. */
export const MAX_ENTITIES = INDEX_MASK + 1;
/** Generations wrap at this point; a stale id survives this many recycles of its slot. */
export const MAX_GENERATION = (1 << (31 - INDEX_BITS)) - 1;

export const packEntity = (index: number, generation: number): EntityId =>
  ((generation & MAX_GENERATION) << INDEX_BITS) | (index & INDEX_MASK);

export const entityIndex = (id: EntityId): number => id & INDEX_MASK;
export const entityGeneration = (id: EntityId): number => (id >>> INDEX_BITS) & MAX_GENERATION;

export interface EntitySnapshot {
  capacity: number;
  /** Alive flags, one byte per slot, as a plain array so it survives JSON. */
  alive: number[];
  generations: number[];
  free: number[];
}

/**
 * Slot allocator. Recycles from a free list LIFO, which keeps live entities densely packed at the
 * low indices — that is what makes the linear query scan cheap.
 */
export class EntityManager {
  private alive: Uint8Array;
  private generations: Uint16Array;
  /** Recycled slots, newest first. */
  private free: number[] = [];
  /** High-water mark of slots ever handed out. Queries only scan up to here. */
  private highWater = 0;
  private liveCount = 0;

  constructor(
    capacity: number = ECS.initialCapacity,
    /** Called when the pool grows, so component stores can grow with it. */
    private readonly onGrow?: (capacity: number) => void,
  ) {
    this.alive = new Uint8Array(capacity);
    this.generations = new Uint16Array(capacity);
  }

  get capacity(): number {
    return this.alive.length;
  }

  /** Live entities. */
  get count(): number {
    return this.liveCount;
  }

  /** Slots that have ever been used — the exclusive upper bound for any scan. */
  get used(): number {
    return this.highWater;
  }

  create(): EntityId {
    const recycled = this.free.pop();
    if (recycled !== undefined) {
      this.alive[recycled] = 1;
      this.liveCount++;
      return packEntity(recycled, this.generations[recycled]!);
    }

    if (this.highWater >= this.capacity) this.grow();
    if (this.highWater >= MAX_ENTITIES) {
      throw new Error(`EntityManager: exhausted ${MAX_ENTITIES} entity slots`);
    }

    const index = this.highWater++;
    this.alive[index] = 1;
    this.liveCount++;
    return packEntity(index, this.generations[index]!);
  }

  /** True only for the exact id that is currently in the slot. */
  isAlive(id: EntityId): boolean {
    if (id === NO_ENTITY || id < 0) return false;
    const index = entityIndex(id);
    if (index >= this.highWater) return false;
    return this.alive[index] === 1 && this.generations[index] === entityGeneration(id);
  }

  /** Returns false when the id was already dead — callers use it to avoid double-destroying. */
  destroy(id: EntityId): boolean {
    if (!this.isAlive(id)) return false;
    const index = entityIndex(id);
    this.alive[index] = 0;
    // Wrap rather than overflow into the index bits, which would corrupt the id space.
    this.generations[index] = (this.generations[index]! + 1) % (MAX_GENERATION + 1);
    this.free.push(index);
    this.liveCount--;
    return true;
  }

  /** Slot is live, ignoring generation. The hot path for query iteration. */
  isSlotAlive(index: number): boolean {
    return this.alive[index] === 1;
  }

  /** The id currently occupying a live slot. */
  idAt(index: number): EntityId {
    return packEntity(index, this.generations[index]!);
  }

  clear(): void {
    this.alive.fill(0);
    this.generations.fill(0);
    this.free.length = 0;
    this.highWater = 0;
    this.liveCount = 0;
  }

  private grow(): void {
    const next = Math.min(MAX_ENTITIES, this.capacity * ECS.growthFactor);
    const alive = new Uint8Array(next);
    alive.set(this.alive);
    const generations = new Uint16Array(next);
    generations.set(this.generations);
    this.alive = alive;
    this.generations = generations;
    this.onGrow?.(next);
  }

  /** Grow to at least `capacity`, for restoring a save bigger than the current pool. */
  reserve(capacity: number): void {
    while (this.capacity < capacity && this.capacity < MAX_ENTITIES) this.grow();
  }

  snapshot(): EntitySnapshot {
    return {
      capacity: this.capacity,
      alive: Array.from(this.alive.subarray(0, this.highWater)),
      generations: Array.from(this.generations.subarray(0, this.highWater)),
      free: [...this.free],
    };
  }

  restore(snapshot: EntitySnapshot): void {
    this.reserve(Math.max(snapshot.capacity, snapshot.alive.length));
    this.clear();
    this.highWater = snapshot.alive.length;
    let live = 0;
    for (let i = 0; i < this.highWater; i++) {
      const flag = snapshot.alive[i] === 1 ? 1 : 0;
      this.alive[i] = flag;
      this.generations[i] = snapshot.generations[i] ?? 0;
      live += flag;
    }
    this.liveCount = live;
    this.free = [...snapshot.free];
  }
}
