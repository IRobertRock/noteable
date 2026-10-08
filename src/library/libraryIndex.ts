// Local index of every item in Library/, so the library opens instantly and
// works offline. Refreshed from Drive on open and every 2 minutes.

import { idbAll, idbClear, idbPut } from '../db';
import { ITEM_FILE, type Item } from '../model/item';
import { readJson, type Storage } from '../storage/Storage';

export interface IndexedItem {
  path: string;
  item: Item;
}

export interface IndexStore {
  all(): Promise<IndexedItem[]>;
  replace(items: IndexedItem[]): Promise<void>;
}

export const idbIndex: IndexStore = {
  all: () => idbAll<IndexedItem>('items'),
  async replace(items) {
    await idbClear('items');
    for (const x of items) await idbPut('items', x.item.id, x);
  },
};

/** Reads every Library/<collection>/<item>/item.json from Drive. */
export async function scanLibrary(storage: Storage): Promise<IndexedItem[]> {
  const out: IndexedItem[] = [];
  const collections = (await storage.list('Library')).filter((e) => e.kind === 'folder');
  for (const col of collections) {
    const folders = (await storage.list(col.path)).filter((e) => e.kind === 'folder');
    const found = await Promise.all(
      folders.map(async (f) => {
        const item = await readJson<Item>(storage, `${f.path}/${ITEM_FILE}`).catch(() => null);
        // The folder decides the collection, so dragging an item between collections in Drive just works.
        return item ? { path: f.path, item: { ...item, collection: col.name } } : null;
      }),
    );
    out.push(...found.filter((x): x is IndexedItem => !!x));
  }
  return out;
}

type Listener = (items: IndexedItem[]) => void;

export class LibraryIndex {
  items: IndexedItem[] = [];
  collections: string[] = [];
  lastSynced: Date | null = null;
  private readonly listeners = new Set<Listener>();
  private refreshing: Promise<void> | null = null;

  constructor(
    private readonly storage: Storage,
    private readonly store: IndexStore = idbIndex,
  ) {}

  async load(): Promise<void> {
    this.items = await this.store.all();
    this.emit();
  }

  byPath(path: string): IndexedItem | undefined {
    return this.items.find((x) => x.path === path);
  }

  byId(id: string): IndexedItem | undefined {
    return this.items.find((x) => x.item.id === id);
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  refresh(): Promise<void> {
    this.refreshing ??= (async () => {
      try {
        const [items, cols] = await Promise.all([
          scanLibrary(this.storage),
          this.storage.list('Library').then((es) => es.filter((e) => e.kind === 'folder').map((e) => e.name)),
        ]);
        this.items = items;
        this.collections = cols.sort((a, b) => a.localeCompare(b));
        this.lastSynced = new Date();
        await this.store.replace(items);
        this.emit();
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  async remove(id: string): Promise<void> {
    this.items = this.items.filter((x) => x.item.id !== id);
    await this.store.replace(this.items);
    this.emit();
  }

  /** Updates one item after this device changes it (import, generate), without a full scan. */
  async put(entry: IndexedItem): Promise<void> {
    this.items = [...this.items.filter((x) => x.item.id !== entry.item.id), entry];
    await this.store.replace(this.items);
    this.emit();
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.items);
  }
}
