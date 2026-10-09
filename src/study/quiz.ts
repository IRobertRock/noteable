// Quiz me: a playlist of review-question segments (question → pause → answer)
// cut from existing chapter audio, across one item or a whole collection.

import type { IndexedItem } from '../library/libraryIndex';

export interface QuizSegment {
  entry: IndexedItem;
  chapter: number;
  start: number;
  end: number;
  /** Where the answer starts (newer audio only), for spoken answers. */
  answer?: number;
  /** Which review question of the chapter this is (0-based), to find its written answer. */
  index: number;
}

export function quizSegments(items: IndexedItem[]): QuizSegment[] {
  const out: QuizSegment[] = [];
  for (const entry of items) {
    for (const c of entry.item.chapters) {
      if (c.status !== 'done' || c.excluded || !c.cues) continue;
      c.cues.forEach((cue, index) => out.push({ entry, chapter: c.n, start: cue.start, end: cue.end, index, ...(cue.answer !== undefined ? { answer: cue.answer } : {}) }));
    }
  }
  return out;
}

/** Teach items with review questions that have no cues yet (generated before cues existed). */
export function needsRegenerating(items: IndexedItem[]): IndexedItem[] {
  return items.filter((x) => x.item.mode === 'teach' && x.item.chapters.some((c) => c.status === 'done' && !c.excluded && !c.cues) && !x.item.chapters.some((c) => c.cues?.length));
}

/** Fisher–Yates with an injectable random source (tests pass a seeded one). */
export function shuffle<T>(xs: T[], random: () => number = Math.random): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
