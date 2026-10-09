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
  /** Furthest point reached in each chapter (chapter number → seconds), for per-chapter progress. */
  heard?: Record<string, number>;
}

/** Flashcard results: Leitner box per card id, synced as State/cards.json (latest wins per card). */
export interface CardsDoc {
  version: 1;
  cards: Record<string, { box: number; updatedAt: string }>;
}

export function mergeCards(a: CardsDoc, b: CardsDoc): CardsDoc {
  const cards = { ...a.cards };
  for (const [id, c] of Object.entries(b.cards ?? {})) if (!cards[id] || c.updatedAt > cards[id].updatedAt) cards[id] = c;
  return { version: 1, cards };
}

/** Items lined up to play after the current one (item ids), synced as State/upnext.json. */
export interface UpNextDoc {
  version: 1;
  items: string[];
  updatedAt: string;
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
  /** Highlights are text picked in the reading view (positionSec is 0). */
  kind?: 'bookmark' | 'highlight';
  text?: string;
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
    if (!mine) {
      items[id] = entry;
      continue;
    }
    // Latest position wins; "furthest heard" per chapter is the max from both devices.
    const winner = entry.updatedAt > mine.updatedAt ? entry : mine;
    const heard = mergeHeard(mine.heard, entry.heard);
    items[id] = heard ? { ...winner, heard } : winner;
  }
  return { version: 1, items };
}

function mergeHeard(a?: Record<string, number>, b?: Record<string, number>): Record<string, number> | undefined {
  if (!a && !b) return undefined;
  const out: Record<string, number> = { ...a };
  for (const [k, v] of Object.entries(b ?? {})) out[k] = Math.max(out[k] ?? 0, v);
  return out;
}

export function mergeUpNext(a: UpNextDoc, b: UpNextDoc): UpNextDoc {
  return (b.updatedAt ?? '') > (a.updatedAt ?? '') ? b : a;
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

const CARDS: Synced<CardsDoc> = { path: 'State/cards.json', key: 'state.cards', empty: { version: 1, cards: {} }, merge: mergeCards };
const UPNEXT: Synced<UpNextDoc> = { path: 'State/upnext.json', key: 'state.upnext', empty: { version: 1, items: [], updatedAt: '' }, merge: mergeUpNext };
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
  upNext: UpNextDoc = UPNEXT.empty;
  cards: CardsDoc = CARDS.empty;
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
    this.upNext = (await this.kv.get<UpNextDoc>(UPNEXT.key)) ?? UPNEXT.empty;
    this.cards = (await this.kv.get<CardsDoc>(CARDS.key)) ?? CARDS.empty;
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
    const positionSec = Math.max(0, Math.round(p.positionSec * 10) / 10);
    const prev = this.playback.items[itemId];
    const heard = { ...prev?.heard, [p.chapter]: Math.max(prev?.heard?.[p.chapter] ?? 0, positionSec) };
    const entry: PlaybackEntry = {
      chapter: p.chapter,
      positionSec,
      speed: clampSpeed(p.speed),
      updatedAt: this.now().toISOString(),
      device: this.deviceName,
      heard,
    };
    this.playback = { version: 1, items: { ...this.playback.items, [itemId]: entry } };
    await this.kv.set(PLAYBACK.key, this.playback);
    this.emit();
  }

  async setCardBox(id: string, box: number): Promise<void> {
    this.cards = { version: 1, cards: { ...this.cards.cards, [id]: { box, updatedAt: this.now().toISOString() } } };
    await this.kv.set(CARDS.key, this.cards);
    this.emit();
  }

  async addHighlight(itemId: string, chapter: number, text: string, note = ''): Promise<Bookmark> {
    const at = this.now().toISOString();
    const b: Bookmark = { id: crypto.randomUUID(), itemId, chapter, positionSec: 0, note, kind: 'highlight', text: text.slice(0, 1000), createdAt: at, updatedAt: at };
    await this.putBookmark(b);
    return b;
  }

  /** Replaces the Up next list (item ids, in play order). */
  async setUpNext(items: string[]): Promise<void> {
    this.upNext = { version: 1, items: [...new Set(items)], updatedAt: this.now().toISOString() };
    await this.kv.set(UPNEXT.key, this.upNext);
    this.emit();
  }

  /** Takes the first item off Up next and returns it. */
  async popUpNext(): Promise<string | undefined> {
    const [first, ...rest] = this.upNext.items;
    if (first) await this.setUpNext(rest);
    return first;
  }

  /** After an item is deleted: drop it from Up next and its bookmarks. */
  async forgetItem(itemId: string): Promise<void> {
    if (this.upNext.items.includes(itemId)) await this.setUpNext(this.upNext.items.filter((i) => i !== itemId));
    for (const b of this.bookmarksFor(itemId)) await this.deleteBookmark(b.id);
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
        this.upNext = await this.syncDoc(UPNEXT, this.upNext);
        this.cards = await this.syncDoc(CARDS, this.cards);
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
