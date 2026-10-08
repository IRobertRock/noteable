import { describe, expect, it } from 'vitest';
import { importMarkdown } from '../src/import/importMarkdown';
import { LibraryIndex, scanLibrary, type IndexedItem, type IndexStore } from '../src/library/libraryIndex';
import type { Item } from '../src/model/item';
import { Downloads, type AudioCache, type DownloadRecord, type TextStore } from '../src/offline/downloads';
import { listenedFraction } from '../src/player/player';
import { readJson, writeJson } from '../src/storage/Storage';
import { FakeDrive, makeStorage } from './fakeDrive';

const GUIDE = '---\ntitle: Week 3\ncollection: ECON 1000\n---\n## One\nFirst.\n\n## Two\nSecond.\n';

async function readyItem() {
  const drive = new FakeDrive();
  const { storage } = makeStorage(drive);
  await storage.write('Inbox/w3.md', GUIDE);
  const { itemPath } = await importMarkdown(storage, 'Inbox/w3.md');
  const item = await readJson<Item>(storage, `${itemPath}/item.json`);
  for (const c of item.chapters) {
    c.status = 'done';
    c.audioFile = `audio/0${c.n}.mp3`;
    c.durationSec = 60;
    await storage.write(`${itemPath}/${c.audioFile}`, new Blob([`mp3-${c.n}`]), 'audio/mpeg');
  }
  item.status = 'ready';
  await writeJson(storage, `${itemPath}/item.json`, item);
  return { drive, storage, itemPath, item };
}

const memoryIndex = (): IndexStore => {
  let items: IndexedItem[] = [];
  return { all: async () => items, replace: async (x) => void (items = [...x]) };
};

function memoryCache(): AudioCache & { map: Map<string, Blob> } {
  const map = new Map<string, Blob>();
  return { map, match: async (k) => map.get(k), put: async (k, b) => void map.set(k, b), delete: async (k) => void map.delete(k) };
}

function memoryTexts(): TextStore {
  const m = new Map<string, string>();
  let records: Record<string, DownloadRecord> = {};
  return {
    get: async (k) => m.get(k),
    put: async (k, t) => void m.set(k, t),
    delete: async (k) => void m.delete(k),
    getRecords: async () => records,
    setRecords: async (r) => void (records = r),
  };
}

describe('library index', () => {
  it('finds items in every collection, taking the collection from the folder', async () => {
    const { storage, itemPath } = await readyItem();
    await storage.mkdir('Library/POLS 1000');
    await storage.move(itemPath, 'Library/POLS 1000/Week 3'); // Rob drags it in Drive
    const items = await scanLibrary(storage);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ path: 'Library/POLS 1000/Week 3', item: { collection: 'POLS 1000', title: 'Week 3' } });
  });

  it('ignores folders without item.json and keeps a local copy for offline use', async () => {
    const { storage } = await readyItem();
    await storage.mkdir('Library/General/Not an item');
    const store = memoryIndex();
    const index = new LibraryIndex(storage, store);
    await index.refresh();
    expect(index.items).toHaveLength(1);
    expect(index.collections).toEqual(['ECON 1000', 'General']);

    const offline = new LibraryIndex(storage, store);
    await offline.load();
    expect(offline.items.map((x) => x.item.title)).toEqual(['Week 3']);
  });
});

describe('downloads', () => {
  it('saves audio and text on the device, then plays and reads them with Drive gone', async () => {
    const { drive, storage, itemPath, item } = await readyItem();
    const cache = memoryCache();
    const dl = new Downloads(storage, cache, memoryTexts());
    const entry = { path: itemPath, item };
    expect(dl.isDownloaded(item)).toBe(false);
    await dl.download(entry);
    expect(dl.isDownloaded(item)).toBe(true);
    expect(dl.records[item.id].bytes).toBe(10);

    drive.validToken = 'nobody'; // simulate airplane mode / signed out
    const offline = new Downloads(makeStorage(drive, { refreshToken: async () => Promise.reject(new Error('offline')) }).storage, cache, dl['texts']);
    await offline.load();
    expect(await (await offline.audio(entry, 2)).text()).toBe('mp3-2');
    expect(await offline.text(entry, 1)).toContain('First.');
  });

  it('remove clears the device copy', async () => {
    const { storage, itemPath, item } = await readyItem();
    const cache = memoryCache();
    const dl = new Downloads(storage, cache, memoryTexts());
    await dl.download({ path: itemPath, item });
    await dl.remove(item);
    expect(cache.map.size).toBe(0);
    expect(dl.isDownloaded(item)).toBe(false);
  });

  it('a newly generated chapter makes the item "not fully downloaded" again', async () => {
    const { storage, itemPath, item } = await readyItem();
    const dl = new Downloads(storage, memoryCache(), memoryTexts());
    await dl.download({ path: itemPath, item });
    const grown = { ...item, chapters: [...item.chapters, { ...item.chapters[0], n: 3 }] };
    expect(dl.isDownloaded(grown)).toBe(false);
  });
});

describe('listenedFraction', () => {
  it('counts earlier chapters plus the position in this one', async () => {
    const { itemPath, item } = await readyItem();
    expect(listenedFraction({ path: itemPath, item }, 2, 30)).toBeCloseTo(0.75);
    expect(listenedFraction({ path: itemPath, item }, 1, 0)).toBe(0);
  });
});
