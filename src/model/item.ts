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
  createdAt: string;
  updatedAt: string;
  lastGenerated?: { device: string; engine: string; realTimeFactor: number; at: string };
}

export const ITEM_FILE = 'item.json';

export function chapterFile(dir: 'text' | 'audio', n: number): string {
  return `${dir}/${String(n).padStart(2, '0')}.${dir === 'text' ? 'md' : 'mp3'}`;
}

export function itemDuration(item: Item): number {
  return item.chapters.reduce((sum, c) => sum + (c.durationSec ?? 0), 0);
}
