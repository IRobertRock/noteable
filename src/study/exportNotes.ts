// Export notes: highlights, bookmark notes and the flashcards still to learn,
// for one item or a whole course, as markdown (uploaded as a Google Doc).

import type { Item } from '../model/item';
import type { Bookmark } from '../sync/state';
import type { Card } from './cards';

export interface NotesSource {
  item: Item;
  bookmarks: Bookmark[];
  /** Cards marked "again" (box 1). */
  again: Card[];
}

const time = (s: number) => {
  const t = Math.round(s);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = String(t % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};

export function notesMarkdown(title: string, sources: NotesSource[], now = new Date()): string {
  const out = [`# ${title}`, '', `Exported from Noteable on ${now.toLocaleDateString('en-CA')}.`, ''];
  let any = false;
  for (const { item, bookmarks, again } of sources) {
    const live = bookmarks.filter((b) => !b.deleted).sort((a, b) => a.chapter - b.chapter || a.positionSec - b.positionSec);
    const highlights = live.filter((b) => b.kind === 'highlight');
    const marks = live.filter((b) => b.kind !== 'highlight' && b.note);
    if (!highlights.length && !marks.length && !again.length) continue;
    any = true;
    const chapter = (n: number) => item.chapters.find((c) => c.n === n)?.title ?? `Chapter ${n}`;
    if (sources.length > 1) out.push(`## ${item.title}`, '');
    const sub = sources.length > 1 ? '###' : '##';
    if (highlights.length) {
      out.push(`${sub} Highlights`, '');
      for (const b of highlights) out.push(`- “${(b.text ?? '').trim()}” (${chapter(b.chapter)})${b.note ? `\n  - Note: ${b.note}` : ''}`);
      out.push('');
    }
    if (marks.length) {
      out.push(`${sub} Bookmarks`, '');
      for (const b of marks) out.push(`- ${chapter(b.chapter)}, ${time(b.positionSec)}: ${b.note}`);
      out.push('');
    }
    if (again.length) {
      out.push(`${sub} Flashcards to work on`, '');
      for (const c of again) out.push(`- **${c.front}** — ${c.back}`);
      out.push('');
    }
  }
  if (!any) out.push('No highlights, bookmark notes or flashcards to work on yet.');
  return out.join('\n');
}
