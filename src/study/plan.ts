// Exam countdown: what to do today for a course with an exam date.

import type { IndexedItem } from '../library/libraryIndex';
import { listenedFraction } from '../player/player';
import type { CardsDoc, PlaybackDoc } from '../sync/state';
import type { Card } from './cards';

/** Whole days from today (local) to the exam date (YYYY-MM-DD); 0 = today, negative = past. */
export function daysUntil(date: string, now = new Date()): number {
  const [y, m, d] = date.split('-').map(Number);
  const exam = new Date(y, m - 1, d).getTime();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((exam - today) / 86_400_000);
}

export const FINISHED = 0.95;

export interface CoursePlan {
  daysLeft: number;
  /** Items not yet listened to (most of the way), oldest first. */
  remaining: IndexedItem[];
  /** Today's share of them, spread across the days left. */
  today: IndexedItem[];
}

export function coursePlan(items: IndexedItem[], playback: PlaybackDoc, examDate: string, now = new Date()): CoursePlan | null {
  const daysLeft = daysUntil(examDate, now);
  if (daysLeft < 0) return null;
  const remaining = items
    .filter((x) => !x.item.review && x.item.chapters.some((c) => c.status === 'done' && !c.excluded))
    .filter((x) => {
      const p = playback.items[x.item.id];
      return !p || listenedFraction(x, p.chapter, p.positionSec) < FINISHED;
    })
    .sort((a, b) => a.item.createdAt.localeCompare(b.item.createdAt));
  // Leave the exam day itself for review.
  const days = Math.max(1, daysLeft);
  return { daysLeft, remaining, today: remaining.slice(0, Math.ceil(remaining.length / days)) };
}

/** Cards in box 1–2 (marked "again" recently, or only known once). */
export function cardsDue(cards: Card[], doc: CardsDoc): Card[] {
  return cards.filter((c) => {
    const box = doc.cards[c.id]?.box;
    return box === 1 || box === 2;
  });
}

export function examLabel(daysLeft: number): string {
  return daysLeft === 0 ? 'exam today' : daysLeft === 1 ? 'exam tomorrow' : `exam in ${daysLeft} days`;
}
