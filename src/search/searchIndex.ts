// Search everything: chapter text of every item (kept in IndexedDB once fetched,
// a few KB per chapter), plus highlights and bookmark notes from synced state.
//
// The library is small (hundreds of chapters), so a scan over lowercased text
// is fast enough and keeps phrase search and snippets simple.

import type { IndexedItem } from '../library/libraryIndex';
import type { Bookmark } from '../sync/state';

export interface SearchDoc {
  /** `${itemId}#${chapter}` */
  key: string;
  itemId: string;
  chapter: number;
  /** item.updatedAt when fetched; a newer item means the text may have changed. */
  version: string;
  markdown: string;
}

export interface SearchHit {
  kind: 'text' | 'highlight' | 'bookmark';
  entry: IndexedItem;
  chapter: number;
  chapterTitle: string;
  snippet: string;
  score: number;
  positionSec?: number;
  /** For highlights: the highlighted text (to find in the reader). */
  find?: string;
}

const STOP = new Set(
  'a an and are as at be but by for from has have he her his i if in into is it its of on or our she so that the their them then there these they this to was we were what when which who will with you your'.split(' '),
);

export function tokenize(s: string): string[] {
  return (s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length > 1 && !STOP.has(w));
}

/** Markdown → plain text for searching and snippets. */
export function plainText(md: string): string {
  return md
    .replace(/^---\n[\s\S]*?\n---\n/, '')
    .replace(/\[pause[^\]]*\]/gi, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#+\s*/gm, '')
    .replace(/[*_`>|]/g, '')
    .replace(/^\s*[-+]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const fold = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

function countWord(hay: string, word: string): number {
  let n = 0;
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'gu');
  while (re.exec(hay)) n++;
  return n;
}

/** Score a text against a query: every word must appear (as a word start); the exact phrase scores extra. */
export function scoreText(text: string, query: string): { score: number; at: number } | null {
  const terms = [...new Set(tokenize(query))];
  if (!terms.length) return null;
  const hay = fold(text);
  let score = 0;
  for (const t of terms) {
    const c = countWord(hay, t);
    if (!c) return null;
    score += Math.min(c, 10);
  }
  const phrase = fold(query).replace(/\s+/g, ' ').trim();
  const phraseAt = hay.indexOf(phrase);
  if (phraseAt >= 0) score += 20;
  const at = phraseAt >= 0 ? phraseAt : hay.search(new RegExp(`(?<![\\p{L}\\p{N}])${terms[0]}`, 'u'));
  return { score, at: Math.max(0, at) };
}

export function snippet(text: string, at: number, before = 60, after = 110): string {
  const start = Math.max(0, text.lastIndexOf(' ', Math.max(0, at - before)) + 1);
  const endSpace = text.indexOf(' ', Math.min(text.length, at + after));
  const end = endSpace < 0 ? text.length : endSpace;
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

/** Query terms to mark in a snippet. */
export function queryTerms(query: string): string[] {
  return [...new Set(tokenize(query))];
}

export function searchAll(
  query: string,
  docs: { doc: SearchDoc; plain: string }[],
  bookmarks: Bookmark[],
  byId: (id: string) => IndexedItem | undefined,
  limit = 60,
): SearchHit[] {
  const hits: SearchHit[] = [];
  const chapterTitle = (e: IndexedItem, n: number) => e.item.chapters.find((c) => c.n === n)?.title ?? `Chapter ${n}`;
  for (const { doc, plain } of docs) {
    const entry = byId(doc.itemId);
    if (!entry) continue;
    const s = scoreText(plain, query);
    if (s) hits.push({ kind: 'text', entry, chapter: doc.chapter, chapterTitle: chapterTitle(entry, doc.chapter), snippet: snippet(plain, s.at), score: s.score });
  }
  for (const b of bookmarks) {
    if (b.deleted) continue;
    const entry = byId(b.itemId);
    if (!entry) continue;
    const text = [b.text, b.note].filter(Boolean).join(' — ');
    const s = scoreText(text, query);
    if (!s) continue;
    hits.push({
      kind: b.kind === 'highlight' ? 'highlight' : 'bookmark',
      entry,
      chapter: b.chapter,
      chapterTitle: chapterTitle(entry, b.chapter),
      snippet: snippet(text, s.at),
      score: s.score + 15, // your own notes first
      positionSec: b.kind === 'highlight' ? undefined : b.positionSec,
      find: b.kind === 'highlight' ? b.text : undefined,
    });
  }
  const titleBonus = (h: SearchHit) => (scoreText(h.entry.item.title, query) ? 5 : 0);
  return hits.sort((a, b) => b.score + titleBonus(b) - (a.score + titleBonus(a))).slice(0, limit);
}

/** Which chapters need (re)fetching, and which stored docs are stale. */
export function indexWork(items: IndexedItem[], stored: Map<string, SearchDoc>): { fetch: { entry: IndexedItem; chapter: number }[]; drop: string[] } {
  const want = new Set<string>();
  const fetch: { entry: IndexedItem; chapter: number }[] = [];
  for (const entry of items) {
    if (entry.item.review) continue; // its chapters are other items' text
    for (const c of entry.item.chapters) {
      if (c.excluded) continue;
      const key = `${entry.item.id}#${c.n}`;
      want.add(key);
      const doc = stored.get(key);
      if (!doc || doc.version !== entry.item.updatedAt) fetch.push({ entry, chapter: c.n });
    }
  }
  return { fetch, drop: [...stored.keys()].filter((k) => !want.has(k)) };
}

export interface DocStore {
  all(): Promise<SearchDoc[]>;
  put(doc: SearchDoc): Promise<void>;
  delete(key: string): Promise<void>;
}

/** Keeps the search docs in step with the library, fetching a batch at a time. */
export class SearchIndexer {
  private docs = new Map<string, { doc: SearchDoc; plain: string }>();
  private loaded = false;
  private running: Promise<void> | null = null;
  progress = { done: 0, total: 0 };

  constructor(
    private readonly store: DocStore,
    private readonly loadText: (entry: IndexedItem, n: number) => Promise<string>,
  ) {}

  private async load(): Promise<void> {
    if (this.loaded) return;
    for (const doc of await this.store.all()) this.docs.set(doc.key, { doc, plain: plainText(doc.markdown) });
    this.loaded = true;
  }

  /** Chapter markdown already on the device (for flashcards due, glossary). */
  async markdownFor(itemId: string): Promise<{ chapter: number; markdown: string }[]> {
    await this.load();
    return [...this.docs.values()].filter((x) => x.doc.itemId === itemId).map((x) => ({ chapter: x.doc.chapter, markdown: x.doc.markdown }));
  }

  async entries(): Promise<{ doc: SearchDoc; plain: string }[]> {
    await this.load();
    return [...this.docs.values()];
  }

  /** Brings the index up to date (at most `batch` fetches per call). Concurrent calls share one run. */
  update(items: IndexedItem[], batch = 60, onProgress?: () => void): Promise<void> {
    this.running ??= (async () => {
      try {
        await this.load();
        const stored = new Map([...this.docs].map(([k, v]) => [k, v.doc]));
        const { fetch, drop } = indexWork(items, stored);
        for (const key of drop) {
          this.docs.delete(key);
          await this.store.delete(key);
        }
        const total = items.reduce((s, x) => s + (x.item.review ? 0 : x.item.chapters.filter((c) => !c.excluded).length), 0);
        this.progress = { done: total - fetch.length, total };
        for (const { entry, chapter } of fetch.slice(0, batch)) {
          try {
            const markdown = await this.loadText(entry, chapter);
            const doc: SearchDoc = { key: `${entry.item.id}#${chapter}`, itemId: entry.item.id, chapter, version: entry.item.updatedAt, markdown };
            await this.store.put(doc);
            this.docs.set(doc.key, { doc, plain: plainText(markdown) });
            this.progress.done++;
            onProgress?.();
          } catch {
            // Offline or missing text: try again next time.
          }
        }
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }
}
