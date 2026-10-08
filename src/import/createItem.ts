// Writes a new item folder: text/NN.md per chapter, text/removed.json,
// item.json, and the original source files in sources/.

import { chapterFile, ITEM_FILE, REMOVED_FILE, type Item } from '../model/item';
import { writeJson, type Storage } from '../storage/Storage';
import { speechPlan, spokenChars } from '../tts/speechText';
import type { Removed } from './types';

export interface NewChapter {
  title: string;
  markdown: string;
  removed?: Removed[];
}

export interface SourceFile {
  name: string;
  /** Already in Noteable (e.g. the Inbox): moved into sources/. */
  movePath?: string;
  /** Otherwise the bytes are written into sources/. */
  blob?: Blob;
}

export interface NewItem {
  title: string;
  collection: string;
  mode: Item['mode'];
  voice: string;
  chapters: NewChapter[];
  sources: SourceFile[];
  ocr?: boolean;
  /** Extra item.json fields (e.g. Zotero details). */
  extra?: Partial<Item>;
}

export async function createItem(storage: Storage, spec: NewItem): Promise<{ itemPath: string; item: Item }> {
  if (!spec.chapters.length) throw new Error('There is no text to narrate in this file.');
  const collection = safeName(spec.collection) || 'General';
  const folder = await uniqueFolder(storage, `Library/${collection}`, safeName(spec.title) || 'Untitled');
  const itemPath = `Library/${collection}/${folder}`;
  const at = new Date().toISOString();

  const item: Item = {
    schema: 1,
    id: crypto.randomUUID(),
    title: spec.title,
    collection,
    mode: spec.mode,
    voice: spec.voice,
    sources: [],
    chapters: spec.chapters.map((c, i) => ({
      n: i + 1,
      title: c.title,
      textFile: chapterFile('text', i + 1),
      chars: spokenChars(speechPlan(c.markdown)),
      status: 'pending',
    })),
    status: 'draft',
    ...(spec.ocr ? { ocr: true } : {}),
    ...spec.extra,
    createdAt: at,
    updatedAt: at,
  };

  for (const [i, c] of spec.chapters.entries()) {
    await storage.write(`${itemPath}/${chapterFile('text', i + 1)}`, c.markdown, 'text/markdown');
  }
  const removed = Object.fromEntries(spec.chapters.map((c, i) => [i + 1, c.removed ?? []]).filter(([, r]) => (r as Removed[]).length));
  if (Object.keys(removed).length) await writeJson(storage, `${itemPath}/${REMOVED_FILE}`, removed);

  // Sources: write copies first, move Inbox files last, so a failed import leaves the Inbox untouched.
  const names = new Set<string>();
  const unique = (name: string) => {
    let n = name;
    for (let i = 2; names.has(n); i++) n = name.replace(/(\.[^.]+)?$/, ` (${i})$1`);
    names.add(n);
    return n;
  };
  const planned = spec.sources.map((s) => ({ ...s, name: unique(safeFileName(s.name)) }));
  item.sources = planned.map((s) => s.name);
  for (const s of planned) if (s.blob) await storage.write(`${itemPath}/sources/${s.name}`, s.blob, s.blob.type || undefined);
  await writeJson(storage, `${itemPath}/${ITEM_FILE}`, item);
  for (const s of planned) if (s.movePath) await storage.move(s.movePath, `${itemPath}/sources/${s.name}`);

  return { itemPath, item };
}

/** Drive allows almost anything, but keep names that also work as Windows folder names. */
export function safeName(name: string): string {
  return name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 100);
}

function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150) || 'source';
}

async function uniqueFolder(storage: Storage, parent: string, name: string): Promise<string> {
  for (let i = 1; ; i++) {
    const candidate = i === 1 ? name : `${name} (${i})`;
    if (!(await storage.stat(`${parent}/${candidate}`))) return candidate;
  }
}
