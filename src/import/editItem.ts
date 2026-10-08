// Saving the text preview: renamed, edited, excluded and reordered chapters,
// and re-reading the sources (e.g. "Re-run with OCR").

import { chapterFile, isComplete, ITEM_FILE, REMOVED_FILE, type Chapter, type Item } from '../model/item';
import { readJson, writeJson, type Storage } from '../storage/Storage';
import { speechPlan, spokenChars } from '../tts/speechText';
import { formatOf, readFormat, type ImportOptions } from './importDocument';
import type { Removed } from './types';

export interface ChapterEdit {
  /** The chapter's number before this edit (identifies it). */
  n: number;
  title: string;
  /** Full chapter markdown; its `## ` line is rewritten from `title`. */
  markdown: string;
  excluded: boolean;
}

export type RemovedMap = Record<string, Removed[]>;

export function withTitle(markdown: string, title: string): string {
  const clean = title.replace(/\s+/g, ' ').trim() || 'Untitled';
  return /^## .*$/m.test(markdown) ? markdown.replace(/^## .*$/m, `## ${clean}`) : `## ${clean}\n\n${markdown.trim()}\n`;
}

/**
 * `edits` lists every chapter in the new order. Reordering is only allowed
 * before any audio exists (audio files are numbered by chapter).
 */
export async function saveEdits(
  storage: Storage,
  itemPath: string,
  item: Item,
  title: string,
  edits: ChapterEdit[],
  originalText: Map<number, string>,
): Promise<Item> {
  const hasAudio = item.chapters.some((c) => c.status === 'done');
  const reordered = edits.some((e, i) => e.n !== item.chapters[i]?.n);
  if (hasAudio && reordered) throw new Error('Chapters can only be reordered before any audio is generated.');
  if (edits.length !== item.chapters.length) throw new Error('Every chapter must be in the edit.');

  const chapters: Chapter[] = [];
  for (const [i, e] of edits.entries()) {
    const orig = item.chapters.find((c) => c.n === e.n);
    if (!orig) throw new Error(`Unknown chapter ${e.n}`);
    const markdown = withTitle(e.markdown, e.title);
    const changed = markdown !== originalText.get(e.n);
    let ch: Chapter = { ...orig, n: reordered ? i + 1 : orig.n, title: e.title.trim() || orig.title, excluded: e.excluded || undefined };
    if (changed) {
      await storage.write(`${itemPath}/${orig.textFile}`, markdown, 'text/markdown');
      ch.chars = spokenChars(speechPlan(markdown));
      if (orig.status === 'done') {
        // Edited after generating: this chapter needs new audio.
        const { audioFile: _a, durationSec: _d, ...rest } = ch;
        ch = { ...rest, status: 'pending' };
      }
    }
    if (!ch.excluded) delete ch.excluded;
    chapters.push(ch);
  }

  if (reordered) {
    const removed = await readJson<RemovedMap>(storage, `${itemPath}/${REMOVED_FILE}`).catch(() => null);
    if (removed) {
      const rekeyed: RemovedMap = {};
      edits.forEach((e, i) => {
        if (removed[e.n]) rekeyed[i + 1] = removed[e.n];
      });
      await writeJson(storage, `${itemPath}/${REMOVED_FILE}`, rekeyed);
    }
  }

  const next: Item = { ...item, title: title.trim() || item.title, chapters, updatedAt: new Date().toISOString() };
  next.status = chapters.some((c) => c.status === 'done') && isComplete(next) ? 'ready' : 'draft';
  await writeJson(storage, `${itemPath}/${ITEM_FILE}`, next);
  return next;
}

/** Re-reads the item's sources (e.g. with OCR forced) and replaces its chapters. Only before any audio exists. */
export async function rereadSources(storage: Storage, itemPath: string, item: Item, opts: ImportOptions): Promise<Item> {
  if (item.chapters.some((c) => c.status === 'done')) throw new Error('Re-reading replaces the text, so it is only available before any audio is generated.');
  const chapters: { title: string; markdown: string; removed?: Removed[] }[] = [];
  let ocr = false;
  for (const name of item.sources) {
    const format = formatOf(name);
    if (!format) continue;
    const blob = await storage.read(`${itemPath}/sources/${name}`);
    const r = await readFormat(format, blob, name, opts);
    ocr ||= !!r.ocrPages;
    chapters.push(...(item.sources.length > 1 && r.chapters.length === 1 ? r.chapters.map((c) => ({ ...c, title: r.title, markdown: withTitle(c.markdown, r.title) })) : r.chapters));
  }
  if (!chapters.length) throw new Error('No text was found in the sources.');

  // Trash text files beyond the new chapter count.
  for (const c of item.chapters.slice(chapters.length)) await storage.delete(`${itemPath}/${c.textFile}`).catch(() => {});
  const removed: RemovedMap = {};
  const next: Item = {
    ...item,
    ocr: ocr || undefined,
    status: 'draft',
    updatedAt: new Date().toISOString(),
    chapters: chapters.map((c, i) => ({ n: i + 1, title: c.title, textFile: chapterFile('text', i + 1), chars: spokenChars(speechPlan(c.markdown)), status: 'pending' })),
  };
  for (const [i, c] of chapters.entries()) {
    await storage.write(`${itemPath}/${chapterFile('text', i + 1)}`, c.markdown, 'text/markdown');
    if (c.removed?.length) removed[i + 1] = c.removed;
  }
  await writeJson(storage, `${itemPath}/${REMOVED_FILE}`, removed);
  await writeJson(storage, `${itemPath}/${ITEM_FILE}`, next);
  return next;
}
