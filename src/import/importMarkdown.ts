// Inbox/<file>.md → Library/<Collection>/<Title>/ with item.json, text/NN.md and sources/<file>.md.

import { chapterFile, ITEM_FILE, type Item } from '../model/item';
import { DEFAULT_VOICE, toVoiceId } from '../model/voices';
import { basename, readText, writeJson, type Storage } from '../storage/Storage';
import { speechPlan, spokenChars } from '../tts/speechText';
import { parseGuide } from './markdown';

export interface ImportResult {
  itemPath: string;
  item: Item;
  warnings: string[];
}

export const IMPORTABLE = /\.(md|markdown|txt)$/i;

export async function importMarkdown(storage: Storage, inboxPath: string, defaultVoice: string = DEFAULT_VOICE): Promise<ImportResult> {
  const fileName = basename(inboxPath);
  const text = await readText(storage, inboxPath);
  const guide = parseGuide(text, fileName);
  if (guide.chapters.length === 0) throw new Error(`${fileName} has no text to narrate.`);

  const warnings = [...guide.warnings];
  const headerVoice = guide.meta.voice && toVoiceId(guide.meta.voice);
  if (guide.meta.voice && !headerVoice) warnings.push(`Unknown voice "${guide.meta.voice}"; using the default.`);

  const collection = safeName(guide.meta.collection) || 'General';
  const folder = await uniqueFolder(storage, `Library/${collection}`, safeName(guide.meta.title) || 'Untitled');
  const itemPath = `Library/${collection}/${folder}`;
  const at = new Date().toISOString();

  const item: Item = {
    schema: 1,
    id: crypto.randomUUID(),
    title: guide.meta.title,
    collection,
    mode: guide.meta.mode,
    voice: headerVoice || defaultVoice,
    sources: [fileName],
    chapters: guide.chapters.map((c, i) => ({
      n: i + 1,
      title: c.title,
      textFile: chapterFile('text', i + 1),
      chars: spokenChars(speechPlan(c.markdown)),
      status: 'pending',
    })),
    status: 'draft',
    createdAt: at,
    updatedAt: at,
  };

  for (const [i, c] of guide.chapters.entries()) {
    await storage.write(`${itemPath}/${chapterFile('text', i + 1)}`, c.markdown, 'text/markdown');
  }
  await writeJson(storage, `${itemPath}/${ITEM_FILE}`, item);
  // Move the original last, so a failed import leaves it in the Inbox to retry.
  await storage.move(inboxPath, `${itemPath}/sources/${fileName}`);

  return { itemPath, item, warnings };
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

async function uniqueFolder(storage: Storage, parent: string, name: string): Promise<string> {
  for (let i = 1; ; i++) {
    const candidate = i === 1 ? name : `${name} (${i})`;
    if (!(await storage.stat(`${parent}/${candidate}`))) return candidate;
  }
}
