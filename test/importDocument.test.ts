// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { saveEdits, withTitle } from '../src/import/editItem';
import { formatOf, importDocuments } from '../src/import/importDocument';
import { REMOVED_FILE, type Item } from '../src/model/item';
import { GOOGLE_DOC, readJson, readText, writeJson } from '../src/storage/Storage';
import { buildDocx, buildPptx } from './fixtures/build';
import { FakeDrive, makeStorage } from './fakeDrive';

async function inboxWith(files: Record<string, Blob>) {
  const drive = new FakeDrive();
  const { storage } = makeStorage(drive);
  for (const [name, blob] of Object.entries(files)) await storage.write(`Inbox/${name}`, blob);
  const entries = await storage.list('Inbox');
  const refs = Object.keys(files).map((name) => {
    const e = entries.find((x) => x.name === name)!;
    return { kind: 'storage' as const, path: e.path, id: e.id, name };
  });
  return { drive, storage, refs };
}

const deck = () =>
  buildPptx([
    { title: 'Week 3', body: ['Opportunity cost'], layout: 'title' },
    { title: 'Definition', body: ['Next best alternative (Mankiw, 2021)'], notes: 'Say it twice.' },
  ]);
const doc = () => buildDocx([{ style: 'Heading1', text: 'Reading' }, { text: 'Body text [1].' }]);

describe('formatOf', () => {
  it('recognises formats by extension or Google type', () => {
    expect(['a.pdf', 'b.DOCX', 'c.pptx', 'd.epub', 'e.md', 'f.txt', 'g.zip'].map((n) => formatOf(n))).toEqual(['pdf', 'docx', 'pptx', 'epub', 'markdown', 'markdown', null]);
    expect(formatOf('Notes', GOOGLE_DOC)).toBe('gdoc');
  });
});

describe('importDocuments', () => {
  it('imports a slide deck from the Inbox: item, cleaned chapters, removed list, source moved', async () => {
    const { drive, storage, refs } = await inboxWith({ 'week3.pptx': new Blob([await deck()]) });
    const r = await importDocuments(storage, refs, { collection: 'ECON 1000' });
    expect(r.itemPath).toBe('Library/ECON 1000/Week 3');
    const item = await readJson<Item>(storage, `${r.itemPath}/item.json`);
    expect(item.sources).toEqual(['week3.pptx']);
    const text = await readText(storage, `${r.itemPath}/${item.chapters[0].textFile}`);
    expect(text).toContain('Next best alternative');
    expect(text).not.toContain('Mankiw');
    expect(text).toContain('Say it twice.');
    const removed = await readJson<Record<string, unknown[]>>(storage, `${r.itemPath}/${REMOVED_FILE}`);
    expect(Object.values(removed).flat().length).toBe(r.removed);
    expect(drive.find('Noteable/Inbox/week3.pptx')).toHaveLength(0);
    expect(drive.find('Noteable/Library/ECON 1000/Week 3/sources/week3.pptx')).toHaveLength(1);
  });

  it('combines several files into one course pack, in order', async () => {
    const { storage, refs } = await inboxWith({ 'b-reading.docx': new Blob([await doc()]), 'a-week3.pptx': new Blob([await deck()]) });
    const r = await importDocuments(storage, [refs[1], refs[0]], { title: 'ECON 1000 Week 3 pack' });
    const item = await readJson<Item>(storage, `${r.itemPath}/item.json`);
    expect(item.title).toBe('ECON 1000 Week 3 pack');
    expect(item.chapters.map((c) => c.title)).toEqual(['Week 3', 'Reading']);
    expect(item.sources).toEqual(['a-week3.pptx', 'b-reading.docx']);
  });

  it('exports a Google Doc as markdown and keeps the export as the source', async () => {
    const drive = new FakeDrive();
    const { storage } = makeStorage(drive);
    storage.exportById = async () => new Blob(['# Lecture\n\n## One\n\nText (Smith, 2019).\n\n## Two\n\nMore.\n'], { type: 'text/markdown' });
    const r = await importDocuments(storage, [{ kind: 'drive', id: 'g1', name: 'Lecture', mimeType: GOOGLE_DOC }]);
    const item = await readJson<Item>(storage, `${r.itemPath}/item.json`);
    expect(item.chapters.map((c) => c.title)).toEqual(['One', 'Two']);
    expect(item.sources).toEqual(['Lecture.md']);
    expect(await readText(storage, `${r.itemPath}/text/01.md`)).toBe('## One\n\nText.\n');
  });

  it('leaves the Inbox untouched when a file cannot be read', async () => {
    const { drive, storage, refs } = await inboxWith({ 'broken.docx': new Blob(['not a zip']) });
    await expect(importDocuments(storage, refs)).rejects.toThrow();
    expect(drive.find('Noteable/Inbox/broken.docx')).toHaveLength(1);
  });
});

describe('saveEdits', () => {
  async function imported() {
    const { storage, refs } = await inboxWith({ 'b.docx': new Blob([await doc()]), 'a.pptx': new Blob([await deck()]) });
    const r = await importDocuments(storage, refs);
    const item = await readJson<Item>(storage, `${r.itemPath}/item.json`);
    const texts = new Map<number, string>();
    for (const c of item.chapters) texts.set(c.n, await readText(storage, `${r.itemPath}/${c.textFile}`));
    return { storage, itemPath: r.itemPath, item, texts };
  }

  it('renames, edits, excludes and reorders before audio exists', async () => {
    const { storage, itemPath, item, texts } = await imported();
    // Pack order is the order given: b.docx ("Reading") then a.pptx ("Week 3").
    const [reading, week3] = item.chapters;
    expect([reading.title, week3.title]).toEqual(['Reading', 'Week 3']);
    const next = await saveEdits(storage, itemPath, item, 'Renamed', [
      { n: week3.n, title: 'First now', markdown: texts.get(week3.n)!, excluded: false },
      { n: reading.n, title: reading.title, markdown: texts.get(reading.n)!.replace('Body text', 'Edited body'), excluded: true },
    ], texts);
    expect(next.title).toBe('Renamed');
    expect(next.chapters.map((c) => [c.n, c.title, !!c.excluded])).toEqual([
      [1, 'First now', false],
      [2, 'Reading', true],
    ]);
    expect(await readText(storage, `${itemPath}/${next.chapters[0].textFile}`)).toMatch(/^## First now\n/);
    expect(await readText(storage, `${itemPath}/${next.chapters[1].textFile}`)).toContain('Edited body');
  });

  it('marks an edited chapter for regeneration once audio exists, and refuses reordering', async () => {
    const { storage, itemPath, item, texts } = await imported();
    item.chapters = item.chapters.map((c) => ({ ...c, status: 'done', audioFile: `audio/0${c.n}.mp3`, durationSec: 10 }));
    item.status = 'ready';
    await writeJson(storage, `${itemPath}/item.json`, item);
    const edits = item.chapters.map((c) => ({ n: c.n, title: c.title, markdown: texts.get(c.n)!, excluded: false }));
    edits[1].markdown += '\nOne more line.\n';
    const next = await saveEdits(storage, itemPath, item, item.title, edits, texts);
    expect(next.chapters.map((c) => c.status)).toEqual(['done', 'pending']);
    expect(next.chapters[1].audioFile).toBeUndefined();
    expect(next.status).toBe('draft');
    await expect(saveEdits(storage, itemPath, next, next.title, [...edits].reverse(), texts)).rejects.toThrow(/reordered/);
  });

  it('withTitle rewrites or adds the chapter heading', () => {
    expect(withTitle('## Old\n\nText\n', 'New')).toBe('## New\n\nText\n');
    expect(withTitle('Text only', 'New')).toBe('## New\n\nText only\n');
  });
});
