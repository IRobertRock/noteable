// Recap on return: after 3+ days away from an item, offer a short refresher
// before resuming: the guide's recap/summary chapter, or the minute before.

import type { IndexedItem } from '../library/libraryIndex';
import type { PlaybackEntry } from '../sync/state';

export const RECAP_AFTER_DAYS = 3;
export const RECAP_REWIND_SEC = 60;

export type RecapPlan =
  | { kind: 'chapter'; chapter: number; title: string; daysAway: number }
  | { kind: 'rewind'; chapter: number; start: number; daysAway: number };

const RECAP_TITLE = /\b(recap|summary|key (points|takeaways|ideas)|in short|review)\b/i;

export function recapPlan(entry: IndexedItem, saved: PlaybackEntry | undefined, now = new Date()): RecapPlan | null {
  if (!saved?.updatedAt) return null;
  const daysAway = Math.floor((now.getTime() - Date.parse(saved.updatedAt)) / 86_400_000);
  if (!(daysAway >= RECAP_AFTER_DAYS)) return null;
  if (saved.chapter === firstChapter(entry) && saved.positionSec < 30) return null; // barely started

  if (entry.item.mode === 'teach') {
    const recap = entry.item.chapters.find((c) => c.status === 'done' && !c.excluded && c.n !== saved.chapter && RECAP_TITLE.test(c.title));
    if (recap) return { kind: 'chapter', chapter: recap.n, title: recap.title, daysAway };
  }
  if (saved.positionSec < RECAP_REWIND_SEC / 2) return null;
  return { kind: 'rewind', chapter: saved.chapter, start: Math.max(0, saved.positionSec - RECAP_REWIND_SEC), daysAway };
}

function firstChapter(entry: IndexedItem): number {
  return entry.item.chapters.find((c) => c.status === 'done' && !c.excluded)?.n ?? 1;
}
