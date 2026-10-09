// Course reviews: a new item made of chapters picked from several items in a
// collection. It points at the source chapters' existing text and audio (no
// regeneration); deleting the review never touches the sources.

import { createItem } from '../import/createItem';
import type { IndexedItem } from '../library/libraryIndex';
import { ITEM_FILE, type Chapter, type Item } from '../model/item';
import { writeJson, type Storage } from '../storage/Storage';

export interface ReviewPick {
  entry: IndexedItem;
  chapter: number;
}

export async function buildReview(storage: Storage, collection: string, title: string, picks: ReviewPick[]): Promise<{ itemPath: string; item: Item }> {
  const chapters: Chapter[] = picks.map((p, i) => {
    const c = p.entry.item.chapters.find((x) => x.n === p.chapter);
    if (!c || c.status !== 'done' || !c.audioFile) throw new Error(`"${p.entry.item.title}" chapter ${p.chapter} has no audio yet.`);
    return { ...c, n: i + 1, title: `${p.entry.item.title}: ${c.title}`, src: p.entry.path };
  });
  if (!chapters.length) throw new Error('Pick at least one chapter.');

  // createItem needs text to write; write a stub and then replace item.json with the referencing chapters.
  const { itemPath, item } = await createItem(storage, {
    title: title.trim() || `${collection} review`,
    collection,
    mode: picks.some((p) => p.entry.item.mode === 'teach') ? 'teach' : 'narrate',
    voice: picks[0].entry.item.voice,
    chapters: [{ title: 'Review', markdown: '## Review\n\nThis review plays chapters from other items.\n' }],
    sources: [],
  });
  await storage.delete(`${itemPath}/${item.chapters[0].textFile}`).catch(() => {});
  const review: Item = { ...item, chapters, status: 'ready', review: true, updatedAt: new Date().toISOString() };
  await writeJson(storage, `${itemPath}/${ITEM_FILE}`, review);
  return { itemPath, item: review };
}

/** The folder a chapter's files live in: its source item for review chapters, else the item itself. */
export function chapterDir(itemPath: string, c: Pick<Chapter, 'src'>): string {
  return c.src ?? itemPath;
}
