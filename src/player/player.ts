// The audio player: one <audio> element, chapter by chapter, with lock-screen
// and earbud controls through the Media Session API.
//
// Position is saved on the device every 10 s and on pause, and synced to
// Drive at most every 30 s, on pause, and when the app is hidden.

import type { IndexedItem } from '../library/libraryIndex';
import type { Downloads } from '../offline/downloads';
import { clampSpeed, type StateStore } from '../sync/state';
import { kvGet, kvSet } from '../db';
import { coverFor } from './artwork';
import { silenceMap, skipTarget, SKIP_FROM_SPEED, type Silence } from './skipSilence';

export const SKIP_SEC = 15;
const SAVE_EVERY_MS = 10_000;
const SYNC_EVERY_MS = 30_000;
/** Resume a little earlier than where you stopped, for context. */
const RESUME_REWIND_SEC = 2;

export interface PlayerState {
  entry: IndexedItem | null;
  chapter: number;
  position: number;
  duration: number;
  playing: boolean;
  loading: boolean;
  speed: number;
  error?: string;
}

type Listener = (s: PlayerState) => void;

export class Player {
  readonly audio: HTMLAudioElement;
  entry: IndexedItem | null = null;
  chapter = 1;
  speed = 1;
  loading = false;
  error?: string;

  /** Shorten dead air at 1.25× and faster (Account/Player toggle; this device only). */
  skipSilence = true;
  private silences: { key: string; list: Silence[] } | null = null;
  private url: string | null = null;
  private preload: { n: number; blob: Promise<Blob> } | null = null;
  private lastSave = 0;
  private lastSync = 0;
  private lastPositionState = 0;
  private loadSeq = 0;
  private readonly listeners = new Set<Listener>();

  constructor(
    private readonly downloads: Downloads,
    private readonly state: StateStore,
    private readonly artwork: string,
    /** Finds a library item by id, for Up next. */
    private readonly resolveItem: (id: string) => IndexedItem | undefined = () => undefined,
  ) {
    void kvGet<boolean>('player.skipSilence').then((v) => {
      if (v === false) this.skipSilence = false;
    });
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.audio.addEventListener('timeupdate', () => this.onTime());
    this.audio.addEventListener('play', () => this.emit());
    this.audio.addEventListener('pause', () => {
      void this.save(true);
      this.emit();
    });
    this.audio.addEventListener('ended', () => void this.onEnded());
    this.audio.addEventListener('ratechange', () => this.updatePositionState(true));
    this.audio.addEventListener('error', () => {
      if (this.url) this.fail('This chapter could not be played.');
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void this.save(true);
    });
    this.setupMediaSession();
  }

  get snapshot(): PlayerState {
    return {
      entry: this.entry,
      chapter: this.chapter,
      position: this.audio.currentTime || 0,
      duration: Number.isFinite(this.audio.duration) ? this.audio.duration : (this.chapterInfo()?.durationSec ?? 0),
      playing: !this.audio.paused,
      loading: this.loading,
      speed: this.speed,
      error: this.error,
    };
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Opens an item at a chapter (default: where you left off) and starts playing. */
  async open(entry: IndexedItem, chapter?: number, position?: number): Promise<void> {
    const saved = this.state.position(entry.item.id);
    const sameItem = this.entry?.item.id === entry.item.id;
    if (this.entry && !sameItem) await this.save(true);
    this.entry = entry;
    this.speed = clampSpeed(saved?.speed ?? 1);
    const n = chapter ?? saved?.chapter ?? firstPlayable(entry);
    const pos = position ?? (chapter === undefined && saved ? Math.max(0, saved.positionSec - RESUME_REWIND_SEC) : 0);
    await this.loadChapter(n, pos, true);
  }

  toggle(): void {
    if (!this.entry) return;
    if (this.audio.paused) void this.audio.play().catch((e) => this.fail(e.message));
    else this.audio.pause();
  }

  play(): void {
    if (this.entry && this.audio.paused) void this.audio.play().catch((e) => this.fail(e.message));
  }

  pause(): void {
    this.audio.pause();
  }

  skip(seconds: number): void {
    if (!this.entry) return;
    const t = this.audio.currentTime + seconds;
    if (t < 0 && seconds < 0 && this.prevPlayable() !== null && this.audio.currentTime < 1) {
      void this.previousChapter(true);
      return;
    }
    const dur = Number.isFinite(this.audio.duration) ? this.audio.duration : Infinity;
    if (t >= dur) {
      void this.nextChapter();
      return;
    }
    this.seekTo(Math.max(0, t));
  }

  seekTo(seconds: number): void {
    this.audio.currentTime = seconds;
    this.updatePositionState(true);
    this.emit();
  }

  async nextChapter(): Promise<void> {
    const n = this.nextPlayable();
    if (n !== null) await this.loadChapter(n, 0, !this.audio.paused || this.audio.ended);
  }

  /** Back to the start of this chapter, or to the previous chapter if already near the start. */
  async previousChapter(toEnd = false): Promise<void> {
    const prev = this.prevPlayable();
    if (this.audio.currentTime > 3 || prev === null) {
      this.seekTo(0);
      return;
    }
    const startAt = toEnd ? Math.max(0, (this.entry?.item.chapters.find((c) => c.n === prev)?.durationSec ?? 0) - SKIP_SEC) : 0;
    await this.loadChapter(prev, startAt, !this.audio.paused);
  }

  setSpeed(speed: number): void {
    this.speed = clampSpeed(speed);
    this.audio.playbackRate = this.speed;
    void this.save(false);
    this.emit();
  }

  /** Saves the position now; `push` also syncs to Drive (errors ignored; it retries later). */
  async save(push: boolean): Promise<void> {
    if (!this.entry) return;
    this.lastSave = Date.now();
    await this.state.savePosition(this.entry.item.id, { chapter: this.chapter, positionSec: this.audio.currentTime || 0, speed: this.speed });
    if (push) {
      this.lastSync = Date.now();
      await this.state.sync().catch(() => {});
    }
  }

  private async loadChapter(n: number, position: number, autoplay: boolean): Promise<void> {
    if (!this.entry) return;
    const seq = ++this.loadSeq;
    this.chapter = n;
    this.loading = true;
    this.error = undefined;
    this.emit();
    try {
      const entry = this.entry;
      const blob = this.preload?.n === n ? await this.preload.blob : await this.downloads.audio(entry, n);
      if (seq !== this.loadSeq) return; // a newer load started meanwhile
      if (this.url) URL.revokeObjectURL(this.url);
      this.url = URL.createObjectURL(blob);
      this.audio.src = this.url;
      this.audio.playbackRate = this.speed;
      this.audio.defaultPlaybackRate = this.speed;
      await new Promise<void>((resolve, reject) => {
        this.audio.addEventListener('loadedmetadata', () => resolve(), { once: true });
        this.audio.addEventListener('error', () => reject(new Error('This chapter could not be played.')), { once: true });
      });
      if (position > 0) this.audio.currentTime = Math.min(position, Math.max(0, this.audio.duration - 0.5));
      this.loading = false;
      this.setMetadata();
      this.mapSilences(entry, n, blob);
      if (autoplay) await this.audio.play();
      void this.save(false);
      this.startPreload();
    } catch (err) {
      if (seq === this.loadSeq) this.fail((err as Error).message);
    } finally {
      if (seq === this.loadSeq) {
        this.loading = false;
        this.emit();
      }
    }
  }

  /** Fetch the next chapter while this one plays, so the hand-over is quick (and works if sign-in lapses). */
  private startPreload(): void {
    const next = this.nextPlayable();
    if (next === null || !this.entry || this.preload?.n === next) return;
    const blob = this.downloads.audio(this.entry, next);
    blob.catch(() => {
      if (this.preload?.n === next) this.preload = null;
    });
    this.preload = { n: next, blob };
  }

  private async onEnded(): Promise<void> {
    if (this.nextPlayable() !== null) {
      await this.loadChapter(this.nextPlayable()!, 0, true);
      return;
    }
    await this.save(true);
    // End of the item: carry on with Up next, if anything is queued.
    for (let id = await this.state.popUpNext(); id; id = await this.state.popUpNext()) {
      const next = this.resolveItem(id);
      if (next && next.item.chapters.some((c) => c.status === 'done' && !c.excluded)) {
        await this.open(next);
        void this.state.sync().catch(() => {});
        return;
      }
    }
    this.emit();
  }

  setSkipSilence(on: boolean): void {
    this.skipSilence = on;
    void kvSet('player.skipSilence', on);
    if (on && this.entry && this.url) void fetch(this.url).then((r) => r.blob()).then((b) => this.mapSilences(this.entry!, this.chapter, b));
    this.emit();
  }

  /** Finds this chapter's silences in the background (only needed when skipping). */
  private mapSilences(entry: IndexedItem, n: number, blob: Blob): void {
    const key = `${entry.item.id}#${n}`;
    if (!this.skipSilence || this.silences?.key === key) return;
    this.silences = null;
    const dur = entry.item.chapters.find((c) => c.n === n)?.durationSec ?? 0;
    if (dur > 45 * 60) return; // keep phone memory in check on very long chapters
    silenceMap(blob)
      .then((list) => {
        if (this.entry?.item.id === entry.item.id && this.chapter === n) this.silences = { key, list };
      })
      .catch(() => {});
  }

  private onTime(): void {
    if (this.skipSilence && this.silences && this.speed >= SKIP_FROM_SPEED && !this.audio.paused) {
      const to = skipTarget(this.silences.list, this.audio.currentTime);
      if (to !== null) this.audio.currentTime = to;
    }
    const now = Date.now();
    if (!this.audio.paused && now - this.lastSave > SAVE_EVERY_MS) {
      const push = now - this.lastSync > SYNC_EVERY_MS;
      void this.save(push);
    }
    this.updatePositionState(false);
    this.emit();
  }

  private chapterInfo() {
    return this.entry?.item.chapters.find((c) => c.n === this.chapter);
  }

  private nextPlayable(): number | null {
    const c = this.entry?.item.chapters.find((x) => x.n > this.chapter && x.status === 'done' && !x.excluded);
    return c ? c.n : null;
  }

  private prevPlayable(): number | null {
    const list = this.entry?.item.chapters.filter((x) => x.n < this.chapter && x.status === 'done' && !x.excluded) ?? [];
    return list.length ? list[list.length - 1].n : null;
  }

  private fail(message: string): void {
    this.error = message;
    this.loading = false;
    this.emit();
  }

  // ---- Media Session (lock screen, notification, earbuds) ----

  private setupMediaSession(): void {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const set = (action: MediaSessionAction, fn: MediaSessionActionHandler) => {
      try {
        ms.setActionHandler(action, fn);
      } catch {
        // Not supported by this browser.
      }
    };
    set('play', () => this.play());
    set('pause', () => this.pause());
    set('seekbackward', (d) => this.skip(-(d.seekOffset ?? SKIP_SEC)));
    set('seekforward', (d) => this.skip(d.seekOffset ?? SKIP_SEC));
    set('previoustrack', () => void this.previousChapter());
    set('nexttrack', () => void this.nextChapter());
    set('seekto', (d) => d.seekTime !== undefined && this.seekTo(d.seekTime));
    set('stop', () => this.pause());
  }

  private setMetadata(): void {
    if (!('mediaSession' in navigator) || !this.entry) return;
    const ch = this.chapterInfo();
    // Short titles read better on lock screens and car displays.
    navigator.mediaSession.metadata = new MediaMetadata({
      title: ch ? `Ch ${ch.n} · ${ch.title}` : this.entry.item.title,
      artist: this.entry.item.title,
      album: this.entry.item.collection,
      artwork: [{ src: coverFor(this.entry.item.collection, this.artwork), sizes: '512x512', type: 'image/png' }],
    });
    this.updatePositionState(true);
  }

  private updatePositionState(force: boolean): void {
    if (!('mediaSession' in navigator) || !Number.isFinite(this.audio.duration)) return;
    const now = Date.now();
    if (!force && now - this.lastPositionState < 5000) return;
    this.lastPositionState = now;
    try {
      navigator.mediaSession.setPositionState({
        duration: this.audio.duration,
        playbackRate: this.audio.playbackRate,
        position: Math.min(this.audio.currentTime, this.audio.duration),
      });
    } catch {
      // Ignore out-of-range glitches while a chapter is switching.
    }
  }

  private emit(): void {
    const s = this.snapshot;
    for (const fn of this.listeners) fn(s);
  }
}

function firstPlayable(entry: IndexedItem): number {
  return entry.item.chapters.find((c) => c.status === 'done' && !c.excluded)?.n ?? 1;
}

/** Fraction of an item listened to, from its saved position. */
export function listenedFraction(entry: IndexedItem, chapter: number, positionSec: number): number {
  const chapters = entry.item.chapters.filter((c) => !c.excluded);
  const total = chapters.reduce((s, c) => s + (c.durationSec ?? 0), 0);
  if (!total) return 0;
  const before = chapters.filter((c) => c.n < chapter).reduce((s, c) => s + (c.durationSec ?? 0), 0);
  return Math.min(1, (before + positionSec) / total);
}
