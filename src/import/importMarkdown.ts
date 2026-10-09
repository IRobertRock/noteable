// Inbox/<file>.md (e.g. a guide Claude wrote) → a Library item. Guides are
// trusted as written: their ## chapters are used as-is, with no cleanup.

import { DEFAULT_VOICE, toVoiceId } from '../model/voices';
import type { Item } from '../model/item';
import { basename, readText, type Storage } from '../storage/Storage';
import { createItem } from './createItem';
import { parseGuide } from './markdown';

export { safeName } from './createItem';

export interface ImportResult {
  itemPath: string;
  item: Item;
  warnings: string[];
}

export const IMPORTABLE = /\.(md|markdown|txt)$/i;

/** Header `voices:` (ids or names) → item.voices; unknown names are dropped with a warning. */
export function guideVoices(v: { question?: string; answer?: string; narrator?: string } | undefined, warnings: string[] = []): Item['voices'] | undefined {
  if (!v) return undefined;
  const pick = (name?: string) => {
    if (!name) return undefined;
    const id = toVoiceId(name);
    if (!id) warnings.push(`Unknown voice "${name}" in voices; using the main voice there.`);
    return id;
  };
  const out = { question: pick(v.question), answer: pick(v.answer), heading: pick(v.narrator) };
  return out.question || out.answer || out.heading ? Object.fromEntries(Object.entries(out).filter(([, x]) => x)) : undefined;
}

export async function importMarkdown(storage: Storage, inboxPath: string, defaultVoice: string = DEFAULT_VOICE): Promise<ImportResult> {
  const fileName = basename(inboxPath);
  const guide = parseGuide(await readText(storage, inboxPath), fileName);
  if (guide.chapters.length === 0) throw new Error(`${fileName} has no text to narrate.`);

  const warnings = [...guide.warnings];
  const headerVoice = guide.meta.voice && toVoiceId(guide.meta.voice);
  if (guide.meta.voice && !headerVoice) warnings.push(`Unknown voice "${guide.meta.voice}"; using the default.`);

  const voices = guideVoices(guide.meta.voices, warnings);
  const { itemPath, item } = await createItem(storage, {
    title: guide.meta.title,
    collection: guide.meta.collection,
    mode: guide.meta.mode,
    voice: headerVoice || defaultVoice,
    chapters: guide.chapters,
    sources: [{ name: fileName, movePath: inboxPath }],
    ...(voices ? { extra: { voices } } : {}),
  });
  return { itemPath, item, warnings };
}
