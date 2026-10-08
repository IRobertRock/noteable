// Playback positions and bookmarks, kept on the device and synced through
// State/playback.json and State/bookmarks.json.
//
// Every change is saved locally first. Syncing reads the Drive copy, merges it
// with the local one (latest updatedAt wins per item / per bookmark), and
// writes back only if the merge changed something. That makes offline use and
// two devices writing at once both safe without a separate outbox.

import { kvGet, kvSet } from '../db';
import { readJson, writeJson, type Storage } from '../storage/Storage';

export interface PlaybackEntry {
  chapter: number;
  positionSec: number;
  speed: number;
  updatedAt: string;
  device: string;
}

export interface PlaybackDoc {
  version: 1;
  items: Record<string, PlaybackEntry>;
}

export interface Bookmark {
  id: string;
  itemId: string;
  chapter: number;
  positionSec: number;
  note: string;
  createdAt: string;
  updatedAt: string;
  deleted?: boolean;
}

export interface BookmarkDoc {
  version: 1;
  bookmarks: Bookmark[];
}

export const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;

export function clampSpeed(speed: number): number {
  const s = Math.round(speed * 4) / 4;
  return Math.min(2, Math.max(0.75, Number.isFinite(s) ? s : 1));
}

export function mergePlayback(a: PlaybackDoc, b: PlaybackDoc): PlaybackDoc {
  const items: Record<string, PlaybackEntry> = { ...a.items };
  for (const [id, entry] of Object.entries(b.items ?? {})) {
    const mine = items[id];
    if (!mine || entry.updatedAt > mine.updatedAt) items[id] = entry;
  }
  return { version: 1, items };
}

export function mergeBookmarks(a: BookmarkDoc, b: BookmarkDoc): BookmarkDoc {
  const byId = new Map(a.bookmarks.map((x) => [x.id, x]));
  for (const x of b.bookmarks ?? []) {
    const mine = byId.get(x.id);
    if (!mine || x.updatedAt > mine.updatedAt) byId.set(x.id, x);
  }
  return { version: 1, bookmarks: [...byId.values()].sort((x, y) => x.createdAt.localeCompare(y.createdAt)) };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

interface Synced<T> {
  path: string;
  key: string;
  empty: T;
  merge: (a: T, b: T) => T;
}

const PLAYBACK: Synced<PlaybackDoc> = { path: 'State/playback.json', key: 'state.playback', empty: { version: 1, items: {} }, merge: mergePlayback };
const BOOKMARKS: Synced<BookmarkDoc> = { path: 'State/bookmarks.json', key: 'state.bookmarks', empty: { version: 1, bookmarks: [] }, merge: mergeBookmarks };

export interface LocalKv {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
}

const idbKv: LocalKv = { get: kvGet, set: kvSet };

type Listener = () => void;

export class StateStore {
  playback: PlaybackDoc = PLAYBACK.empty;
  bookmarks: BookmarkDoc = BOOKMARKS.empty;
  private readonly listeners = new Set<Listener>();
  private syncing: Promise<void> | null = null;

  constructor(
    private readonly storage: Storage,
    readonly deviceName: string,
    private readonly kv: LocalKv = idbKv,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async load(): Promise<void> {
    this.playback = (await this.kv.get<PlaybackDoc>(PLAYBACK.key)) ?? PLAYBACK.empty;
    this.bookmarks = (await this.kv.get<BookmarkDoc>(BOOKMARKS.key)) ?? BOOKMARKS.empty;
    this.emit();
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  position(itemId: string): PlaybackEntry | undefined {
    return this.playback.items[itemId];
  }

  async savePosition(itemId: string, p: Pick<PlaybackEntry, 'chapter' | 'positionSec' | 'speed'>): Promise<void> {
    const entry: PlaybackEntry = {
      chapter: p.chapter,
      positionSec: Math.max(0, Math.round(p.positionSec * 10) / 10),
      speed: clampSpeed(p.speed),
      updatedAt: this.now().toISOString(),
      device: this.deviceName,
    };
    this.playback = { version: 1, items: { ...this.playback.items, [itemId]: entry } };
    await this.kv.set(PLAYBACK.key, this.playback);
    this.emit();
  }

  bookmarksFor(itemId: string): Bookmark[] {
    return this.bookmarks.bookmarks.filter((b) => b.itemId === itemId && !b.deleted);
  }

  async addBookmark(itemId: string, chapter: number, positionSec: number, note = ''): Promise<Bookmark> {
    const at = this.now().toISOString();
    const b: Bookmark = { id: crypto.randomUUID(), itemId, chapter, positionSec: Math.round(positionSec * 10) / 10, note, createdAt: at, updatedAt: at };
    await this.putBookmark(b);
    return b;
  }

  async editBookmark(id: string, note: string): Promise<void> {
    const b = this.bookmarks.bookmarks.find((x) => x.id === id);
    if (b) await this.putBookmark({ ...b, note, updatedAt: this.now().toISOString() });
  }

  async deleteBookmark(id: string): Promise<void> {
    const b = this.bookmarks.bookmarks.find((x) => x.id === id);
    if (b) await this.putBookmark({ ...b, deleted: true, updatedAt: this.now().toISOString() });
  }

  /** Merge with Drive in both directions. Safe to call often; concurrent calls share one run. */
  sync(): Promise<void> {
    this.syncing ??= (async () => {
      try {
        this.playback = await this.syncDoc(PLAYBACK, this.playback);
        this.bookmarks = await this.syncDoc(BOOKMARKS, this.bookmarks);
        this.emit();
      } finally {
        this.syncing = null;
      }
    })();
    return this.syncing;
  }

  private async putBookmark(b: Bookmark): Promise<void> {
    this.bookmarks = mergeBookmarks(this.bookmarks, { version: 1, bookmarks: [b] });
    await this.kv.set(BOOKMARKS.key, this.bookmarks);
    this.emit();
  }

  private async syncDoc<T>(spec: Synced<T>, local: T): Promise<T> {
    const remote = await readJson<T>(this.storage, spec.path).catch((err: { status?: number }) => {
      if (err?.status === 404) return spec.empty;
      throw err;
    });
    const merged = spec.merge(spec.merge(spec.empty, remote), local);
    if (!same(merged, remote)) await writeJson(this.storage, spec.path, merged);
    // Local may have changed while we were talking to Drive; fold that in too.
    const latest = spec.merge(merged, (await this.kv.get<T>(spec.key)) ?? spec.empty);
    await this.kv.set(spec.key, latest);
    return latest;
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}
