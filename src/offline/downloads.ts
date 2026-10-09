// Download for offline: MP3s go to Cache Storage, chapter text to IndexedDB.
// Audio and text are read through here so the player and reader don't care
// whether an item is downloaded.

import { idbDelete, idbGet, idbPut } from '../db';
import type { IndexedItem } from '../library/libraryIndex';
import type { Item } from '../model/item';
import { readText, type Storage } from '../storage/Storage';
import { chapterDir } from '../study/review';

const CACHE = 'noteable-audio-v1';
const DOWNLOADS_KEY = 'downloads';

export interface DownloadRecord {
  itemId: string;
  chapters: number[];
  bytes: number;
  at: string;
}

/** Minimal Cache Storage surface, so tests can use a fake. */
export interface AudioCache {
  match(key: string): Promise<Blob | undefined>;
  put(key: string, blob: Blob): Promise<void>;
  delete(key: string): Promise<void>;
}

export const browserCache: AudioCache = {
  async match(key) {
    const res = await (await caches.open(CACHE)).match(key);
    return res ? res.blob() : undefined;
  },
  async put(key, blob) {
    await (await caches.open(CACHE)).put(key, new Response(blob, { headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': String(blob.size) } }));
  },
  async delete(key) {
    await (await caches.open(CACHE)).delete(key);
  },
};

export interface TextStore {
  get(key: string): Promise<string | undefined>;
  put(key: string, text: string): Promise<void>;
  delete(key: string): Promise<void>;
  getRecords(): Promise<Record<string, DownloadRecord>>;
  setRecords(r: Record<string, DownloadRecord>): Promise<void>;
}

export const idbTexts: TextStore = {
  get: (k) => idbGet<string>('texts', k),
  put: (k, t) => idbPut('texts', k, t),
  delete: (k) => idbDelete('texts', k),
  getRecords: async () => (await idbGet<Record<string, DownloadRecord>>('kv', DOWNLOADS_KEY)) ?? {},
  setRecords: (r) => idbPut('kv', DOWNLOADS_KEY, r),
};

// A same-origin URL used only as a cache key; nothing is ever fetched from it.
const audioKey = (itemId: string, n: number) => `${location.origin}${import.meta.env.BASE_URL}offline/${itemId}/${n}.mp3`;
const textKey = (itemId: string, n: number) => `${itemId}#${n}`;

type Listener = () => void;

export class Downloads {
  records: Record<string, DownloadRecord> = {};
  /** itemId → 0–1 while downloading. */
  readonly active = new Map<string, number>();
  private readonly listeners = new Set<Listener>();

  constructor(
    private readonly storage: Storage,
    private readonly cache: AudioCache = browserCache,
    private readonly texts: TextStore = idbTexts,
  ) {}

  async load(): Promise<void> {
    this.records = await this.texts.getRecords();
    this.emit();
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  isDownloaded(item: Item): boolean {
    const r = this.records[item.id];
    if (!r) return false;
    return item.chapters.filter((c) => c.status === 'done' && !c.excluded).every((c) => r.chapters.includes(c.n));
  }

  async download({ path, item }: IndexedItem): Promise<void> {
    const chapters = item.chapters.filter((c) => c.status === 'done' && !c.excluded && c.audioFile);
    let bytes = 0;
    // Ask the browser not to clear downloads when space runs low (granted readily to installed apps).
    await navigator.storage?.persist?.().catch(() => false);
    this.active.set(item.id, 0);
    this.emit();
    try {
      for (const [i, c] of chapters.entries()) {
        const blob = await this.storage.read(`${chapterDir(path, c)}/${c.audioFile}`);
        await this.cache.put(audioKey(item.id, c.n), blob);
        await this.texts.put(textKey(item.id, c.n), await readText(this.storage, `${chapterDir(path, c)}/${c.textFile}`));
        bytes += blob.size;
        this.active.set(item.id, (i + 1) / chapters.length);
        this.emit();
      }
      this.records = { ...this.records, [item.id]: { itemId: item.id, chapters: chapters.map((c) => c.n), bytes, at: new Date().toISOString() } };
      await this.texts.setRecords(this.records);
    } finally {
      this.active.delete(item.id);
      this.emit();
    }
  }

  async remove(item: Item): Promise<void> {
    for (const c of item.chapters) {
      await this.cache.delete(audioKey(item.id, c.n));
      await this.texts.delete(textKey(item.id, c.n));
    }
    const { [item.id]: _gone, ...rest } = this.records;
    this.records = rest;
    await this.texts.setRecords(this.records);
    this.emit();
  }

  /** The chapter's MP3, from the device if downloaded, else from Drive. */
  async audio({ path, item }: IndexedItem, n: number): Promise<Blob> {
    const cached = await this.cache.match(audioKey(item.id, n));
    if (cached) return cached;
    const c = item.chapters.find((x) => x.n === n);
    if (!c?.audioFile) throw new Error(`Chapter ${n} has no audio yet.`);
    const blob = await this.storage.read(`${chapterDir(path, c)}/${c.audioFile}`);
    return blob.type ? blob : new Blob([blob], { type: 'audio/mpeg' });
  }

  /** The chapter's markdown, from the device if downloaded, else from Drive. */
  async text({ path, item }: IndexedItem, n: number): Promise<string> {
    const cached = await this.texts.get(textKey(item.id, n));
    if (cached !== undefined) return cached;
    const c = item.chapters.find((x) => x.n === n);
    if (!c) throw new Error(`No chapter ${n}`);
    return readText(this.storage, `${chapterDir(path, c)}/${c.textFile}`);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}
