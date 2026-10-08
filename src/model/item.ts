// item.json: one per item folder in Library/<Collection>/<Item>/.

export type ChapterStatus = 'pending' | 'done';
export type ItemStatus = 'draft' | 'generating' | 'ready' | 'error';

export interface Chapter {
  n: number;
  title: string;
  /** Relative to the item folder, e.g. "text/01.md". */
  textFile: string;
  /** Relative to the item folder, e.g. "audio/01.mp3". Set once uploaded. */
  audioFile?: string;
  durationSec?: number;
  chars: number;
  status: ChapterStatus;
  /** Left out of audio and reading (set in the preview). */
  excluded?: boolean;
}

export interface Item {
  schema: 1;
  id: string;
  title: string;
  collection: string;
  mode: 'narrate' | 'teach';
  voice: string;
  /** File names in sources/. */
  sources: string[];
  chapters: Chapter[];
  status: ItemStatus;
  error?: string;
  /** Some text came from OCR (shown as a reminder in the preview). */
  ocr?: boolean;
  /** Where it came from in Zotero (for the item page). */
  zotero?: { key: string; authors: string; year?: string; publication?: string };
  /** The guide.md version this item last used or dismissed. */
  guide?: { modifiedTime: string; dismissed?: boolean };
  createdAt: string;
  updatedAt: string;
  lastGenerated?: { device: string; engine: string; realTimeFactor: number; at: string };
}

export const ITEM_FILE = 'item.json';

export function chapterFile(dir: 'text' | 'audio', n: number): string {
  return `${dir}/${String(n).padStart(2, '0')}.${dir === 'text' ? 'md' : 'mp3'}`;
}

/** Chapters that count: not excluded in the preview. */
export function activeChapters(item: Item): Chapter[] {
  return item.chapters.filter((c) => !c.excluded);
}

export function isComplete(item: Item): boolean {
  return activeChapters(item).every((c) => c.status === 'done');
}

/** Per-chapter list of what cleanup removed, for "Show removed". */
export const REMOVED_FILE = 'text/removed.json';

export function itemDuration(item: Item): number {
  return activeChapters(item).reduce((sum, c) => sum + (c.durationSec ?? 0), 0);
}
