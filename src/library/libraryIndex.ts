// Local index of every item in Library/, so the library opens instantly and
// works offline. Refreshed from Drive on open and every 2 minutes.

import { idbAll, idbClear, idbPut } from '../db';
import { ITEM_FILE, type Item } from '../model/item';
import { readJson, type Storage } from '../storage/Storage';

export interface IndexedItem {
  path: string;
  item: Item;
  /** Drive folder id of the item (for the change feed). */
  folderId?: string;
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
        return item ? { path: f.path, folderId: f.id, item: { ...item, collection: col.name } } : null;
      }),
    );
    out.push(...(found.filter(Boolean) as IndexedItem[]));
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
  /** Change-feed state: the token and the folder ids a full scan saw. */
  private changeToken: string | null = null;
  private containerIds = new Set<string>();
  private lastFullScan = 0;
  /** A full rescan at least this often, as a safety net for anything the feed misses. */
  static readonly FULL_SCAN_MS = 30 * 60_000;

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

  /**
   * Cheap refresh: asks Drive what changed and re-reads only affected items. Falls back to a
   * full scan when there's no token yet, every 30 minutes, or when folders appear or move.
   */
  refreshChanges(now = Date.now()): Promise<void> {
    const changes = this.storage.changes?.bind(this.storage);
    if (!changes || !this.changeToken || now - this.lastFullScan > LibraryIndex.FULL_SCAN_MS) return this.refresh();
    this.refreshing ??= (async () => {
      try {
        const { token, changed } = await changes(this.changeToken!);
        this.changeToken = token;
        const byFolder = new Map(this.items.filter((x) => x.folderId).map((x) => [x.folderId!, x]));
        let needFull = false;
        const reread = new Set<IndexedItem>();
        for (const c of changed) {
          const parentItem = c.parents.map((p) => byFolder.get(p)).find(Boolean);
          if (parentItem && c.name === ITEM_FILE) reread.add(parentItem);
          else if (byFolder.has(c.id) || c.parents.some((p) => this.containerIds.has(p)) || this.containerIds.has(c.id)) needFull = true;
        }
        if (needFull) {
          this.refreshing = null;
          return await this.refresh();
        }
        if (!reread.size) {
          this.lastSynced = new Date();
          this.emit();
          return;
        }
        for (const x of reread) {
          const item = await readJson<Item>(this.storage, `${x.path}/${ITEM_FILE}`).catch(() => null);
          this.items = item ? this.items.map((y) => (y === x ? { ...x, item: { ...item, collection: x.item.collection } } : y)) : this.items.filter((y) => y !== x);
        }
        this.lastSynced = new Date();
        await this.store.replace(this.items);
        this.emit();
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  refresh(): Promise<void> {
    this.refreshing ??= (async () => {
      try {
        // Take the change token before scanning, so nothing between the two is missed.
        const start = this.storage.changes ? await this.storage.changes().catch(() => null) : null;
        const [items, cols] = await Promise.all([
          scanLibrary(this.storage),
          this.storage.list('Library').then((es) => es.filter((e) => e.kind === 'folder').map((e) => e.name)),
        ]);
        this.items = items;
        this.collections = cols.sort((a, b) => a.localeCompare(b));
        this.lastSynced = new Date();
        this.lastFullScan = Date.now();
        if (start) this.changeToken = start.token;
        const library = await this.storage.stat('Library').catch(() => null);
        const colIds = (await this.storage.list('Library').catch(() => [])).filter((e) => e.kind === 'folder').map((e) => e.id);
        this.containerIds = new Set([...(library ? [library.id] : []), ...colIds]);
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
