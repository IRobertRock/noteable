// "Continue listening" and per-chapter progress, from synced playback state.

import type { IndexedItem } from './libraryIndex';
import type { Chapter } from '../model/item';
import type { PlaybackDoc, PlaybackEntry } from '../sync/state';

/** Within this many seconds of the end counts as finished. */
export const FINISHED_WITHIN_SEC = 30;

export type ChapterProgress = 'done' | 'part' | 'none';

export function chapterProgress(entry: PlaybackEntry | undefined, c: Chapter): ChapterProgress {
  const heard = entry?.heard?.[c.n] ?? (entry && entry.chapter > c.n ? Infinity : entry?.chapter === c.n ? entry.positionSec : 0);
  if (!heard) return 'none';
  const dur = c.durationSec ?? 0;
  if (dur && heard >= dur - Math.min(15, dur * 0.1)) return 'done';
  return heard > 5 ? 'part' : 'none';
}

export function isFinished(entry: PlaybackEntry, x: IndexedItem): boolean {
  const playable = x.item.chapters.filter((c) => c.status === 'done' && !c.excluded);
  const last = playable[playable.length - 1];
  if (!last) return false;
  return entry.chapter === last.n && entry.positionSec >= (last.durationSec ?? 0) - FINISHED_WITHIN_SEC;
}

/** Started, unfinished, playable items, most recently played first. */
export function continueListening(items: IndexedItem[], playback: PlaybackDoc, limit = 3): IndexedItem[] {
  return items
    .map((x) => ({ x, e: playback.items[x.item.id] }))
    .filter(({ x, e }) => e && x.item.chapters.some((c) => c.status === 'done' && !c.excluded) && !isFinished(e, x) && (e.positionSec > 5 || e.chapter > (x.item.chapters[0]?.n ?? 1)))
    .sort((a, b) => b.e!.updatedAt.localeCompare(a.e!.updatedAt))
    .slice(0, limit)
    .map(({ x }) => x);
}
