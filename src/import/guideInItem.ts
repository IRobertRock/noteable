// A study guide Claude saved straight into an item's folder (guide.md).
// The item page offers to switch the item to the guide: its ## chapters
// replace the item's text, the item becomes a Teach item, and the guide's
// voice (if any) is used.

import { chapterFile, ITEM_FILE, REMOVED_FILE, type Item } from '../model/item';
import { toVoiceId } from '../model/voices';
import { readText, writeJson, type Entry, type Storage } from '../storage/Storage';
import { speechPlan, spokenChars } from '../tts/speechText';
import { parseGuide } from './markdown';
import { guideVoices } from './importMarkdown';

export const GUIDE_FILE = 'guide.md';

/** The guide.md entry if there is one this item hasn't used yet (or it changed since). */
export async function newGuide(storage: Storage, itemPath: string, item: Item): Promise<Entry | null> {
  const guide = await storage.stat(`${itemPath}/${GUIDE_FILE}`).catch(() => null);
  if (!guide || guide.kind !== 'file') return null;
  return item.guide?.modifiedTime === guide.modifiedTime ? null : guide;
}

export async function applyGuide(storage: Storage, itemPath: string, item: Item, guide: Entry): Promise<Item> {
  const parsed = parseGuide(await readText(storage, `${itemPath}/${GUIDE_FILE}`), GUIDE_FILE);
  if (!parsed.chapters.length) throw new Error('guide.md has no ## chapters to read.');

  for (const [i, c] of parsed.chapters.entries()) {
    await storage.write(`${itemPath}/${chapterFile('text', i + 1)}`, c.markdown, 'text/markdown');
  }
  // Old text and audio beyond the guide's length would be confusing; trash them (recoverable in Drive).
  for (const c of item.chapters.slice(parsed.chapters.length)) {
    await storage.delete(`${itemPath}/${c.textFile}`).catch(() => {});
    if (c.audioFile) await storage.delete(`${itemPath}/${c.audioFile}`).catch(() => {});
  }
  await storage.delete(`${itemPath}/${REMOVED_FILE}`).catch(() => {});

  const next: Item = {
    ...item,
    title: parsed.meta.title && parsed.meta.title !== 'guide' ? parsed.meta.title : item.title,
    mode: 'teach',
    voice: toVoiceId(parsed.meta.voice) ?? item.voice,
    voices: guideVoices(parsed.meta.voices),
    chapters: parsed.chapters.map((c, i) => ({ n: i + 1, title: c.title, textFile: chapterFile('text', i + 1), chars: spokenChars(speechPlan(c.markdown)), status: 'pending' })),
    status: 'draft',
    error: undefined,
    ocr: undefined,
    guide: { modifiedTime: guide.modifiedTime },
    updatedAt: new Date().toISOString(),
  };
  await writeJson(storage, `${itemPath}/${ITEM_FILE}`, next);
  return next;
}

/** Keep the item as it is, and stop offering this version of the guide. */
export async function dismissGuide(storage: Storage, itemPath: string, item: Item, guide: Entry): Promise<Item> {
  const next: Item = { ...item, guide: { modifiedTime: guide.modifiedTime, dismissed: true } };
  await writeJson(storage, `${itemPath}/${ITEM_FILE}`, next);
  return next;
}
