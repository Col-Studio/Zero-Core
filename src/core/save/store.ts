/**
 * Where saves live: IndexedDB in the browser, memory everywhere else.
 *
 * IndexedDB rather than localStorage because a world with 10k entities is megabytes of JSON and
 * localStorage is a synchronous ~5 MB cliff that blocks the main thread — an autosave every 30
 * simulated seconds would be a visible hitch. IndexedDB stores structured data off-thread.
 *
 * The `IDBFactory` is injectable so this file is testable without a browser, and the memory store
 * is a first-class implementation rather than a stub: Vitest, replay tooling, and any headless
 * determinism run all use it, so it has to behave identically — including deep-copying on write,
 * which is what stops a "save" from being a live reference to the world that keeps mutating.
 */

import type { SaveEnvelope } from './format';
import { SAVE } from '../core.data';

export interface SaveMeta {
  slot: string;
  seed: number;
  tick: number;
  version: number;
  hash: string;
  /** Rough serialized size in bytes — the overlay shows it so nobody ships a 40 MB autosave. */
  bytes: number;
}

export interface SaveStore {
  readonly kind: 'indexeddb' | 'memory';
  put(save: SaveEnvelope): Promise<void>;
  get(slot: string): Promise<SaveEnvelope | null>;
  list(): Promise<SaveMeta[]>;
  remove(slot: string): Promise<void>;
  clear(): Promise<void>;
}

const metaOf = (save: SaveEnvelope, bytes: number): SaveMeta => ({
  slot: save.slot,
  seed: save.seed,
  tick: save.tick,
  version: save.version,
  hash: save.hash,
  bytes,
});

/** Deep copy through JSON — also the check that a save really is plain serializable data. */
const detach = (save: SaveEnvelope): { copy: SaveEnvelope; bytes: number } => {
  const text = JSON.stringify(save);
  return { copy: JSON.parse(text) as SaveEnvelope, bytes: text.length };
};

export function createMemorySaveStore(): SaveStore {
  const slots = new Map<string, { save: SaveEnvelope; bytes: number }>();

  return {
    kind: 'memory',
    async put(save) {
      const { copy, bytes } = detach(save);
      slots.set(save.slot, { save: copy, bytes });
    },
    async get(slot) {
      const entry = slots.get(slot);
      return entry === undefined ? null : (JSON.parse(JSON.stringify(entry.save)) as SaveEnvelope);
    },
    async list() {
      return [...slots.values()]
        .map((entry) => metaOf(entry.save, entry.bytes))
        .sort((a, b) => (a.slot < b.slot ? -1 : 1));
    },
    async remove(slot) {
      slots.delete(slot);
    },
    async clear() {
      slots.clear();
    },
  };
}

/** Promise wrapper for the request/event API. Every IDB call in this file goes through it. */
function wrap<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('indexeddb request failed'));
  });
}

export function createIndexedDbSaveStore(factory: IDBFactory): SaveStore {
  let db: IDBDatabase | null = null;

  const open = async (): Promise<IDBDatabase> => {
    if (db !== null) return db;
    const request = factory.open(SAVE.dbName, SAVE.version);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(SAVE.storeName)) {
        database.createObjectStore(SAVE.storeName, { keyPath: 'slot' });
      }
    };
    db = await wrap(request);
    return db;
  };

  const withStore = async <T>(
    mode: IDBTransactionMode,
    body: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> => {
    const database = await open();
    const tx = database.transaction(SAVE.storeName, mode);
    const result = await wrap(body(tx.objectStore(SAVE.storeName)));
    return result;
  };

  return {
    kind: 'indexeddb',
    async put(save) {
      const { copy } = detach(save);
      await withStore('readwrite', (store) => store.put(copy));
    },
    async get(slot) {
      const found = await withStore<SaveEnvelope | undefined>('readonly', (store) =>
        store.get(slot),
      );
      return found ?? null;
    },
    async list() {
      const all = await withStore<SaveEnvelope[]>('readonly', (store) => store.getAll());
      return all
        .map((save) => metaOf(save, JSON.stringify(save).length))
        .sort((a, b) => (a.slot < b.slot ? -1 : 1));
    },
    async remove(slot) {
      await withStore('readwrite', (store) => store.delete(slot));
    },
    async clear() {
      await withStore('readwrite', (store) => store.clear());
    },
  };
}

/**
 * IndexedDB when the platform has it, memory otherwise. Never throws: a save system that breaks
 * the game because storage is unavailable (private mode, disabled cookies, a headless test) is
 * worse than one that forgets.
 */
export function createSaveStore(factory?: IDBFactory): SaveStore {
  const resolved =
    factory ?? (typeof indexedDB === 'undefined' ? undefined : (indexedDB as IDBFactory));
  if (resolved === undefined) return createMemorySaveStore();
  try {
    return createIndexedDbSaveStore(resolved);
  } catch {
    return createMemorySaveStore();
  }
}
