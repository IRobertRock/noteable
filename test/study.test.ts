import { describe, expect, it } from 'vitest';
import { generateItem } from '../src/generate/generateItem';
import { memoryPending } from '../src/generate/pending';
import { importMarkdown } from '../src/import/importMarkdown';
import { LibraryIndex, type IndexStore } from '../src/library/libraryIndex';
import type { Item } from '../src/model/item';
import { Downloads, type AudioCache, type TextStore } from '../src/offline/downloads';
import { readJson } from '../src/storage/Storage';
import { cardsFromMarkdown, nextBox, orderCards } from '../src/study/cards';
import { INLINE_LIMIT, studyGuidePrompt } from '../src/study/claudePrompt';
import { needsRegenerating, quizSegments, shuffle } from '../src/study/quiz';
import { buildReview } from '../src/study/review';
import { mergeCards } from '../src/sync/state';
import type { Mp3Writer } from '../src/audio/mp3';
import { FakeDrive, makeStorage } from './fakeDrive';

const GUIDE = `## Key terms
- **Opportunity cost:** the value of the next best alternative given up.
- **Scarcity**: having less than people want.

## Review questions
**Q:** If your wage rises, does a night off cost more?

[pause 5s]

**A:** Yes, because each hour off gives up more income.

**Q:** Is a free concert free? **A:** No; it costs your time.
`;

describe('flashcards', () => {
  it('finds key terms and Q/A pairs, with clean text', () => {
    const cards = cardsFromMarkdown('item1', 2, GUIDE);
    expect(cards.map((c) => [c.kind, c.front, c.back])).toEqual([
      ['term', 'Opportunity cost', 'the value of the next best alternative given up.'],
      ['term', 'Scarcity', 'having less than people want.'],
      ['qa', 'If your wage rises, does a night off cost more?', 'Yes, because each hour off gives up more income.'],
      ['qa', 'Is a free concert free?', "No; it costs your time."],
    ]);
    expect(new Set(cards.map((c) => c.id)).size).toBe(4);
    expect(cardsFromMarkdown('item1', 2, GUIDE)[0].id).toBe(cards[0].id); // stable
  });

  it('shows "again" cards first, then new ones, then known ones; boxes move up and reset', () => {
    const cards = cardsFromMarkdown('i', 1, GUIDE);
    const doc = { version: 1 as const, cards: { [cards[0].id]: { box: 3, updatedAt: 't' }, [cards[2].id]: { box: 1, updatedAt: 't' } } };
    expect(orderCards(cards, doc).map((c) => c.front)).toEqual([cards[2].front, cards[1].front, cards[3].front, cards[0].front]);
    expect([nextBox(undefined, true), nextBox(1, true), nextBox(5, true), nextBox(4, false)]).toEqual([2, 2, 5, 1]);
    expect(mergeCards({ version: 1, cards: { a: { box: 1, updatedAt: '2' } } }, { version: 1, cards: { a: { box: 4, updatedAt: '1' }, b: { box: 2, updatedAt: '1' } } }).cards).toEqual({
      a: { box: 1, updatedAt: '2' },
      b: { box: 2, updatedAt: '1' },
    });
  });
});

// ---- items with audio for quiz/review tests ----

const fakeWriter = async (): Promise<Mp3Writer> => {
  let sec = 0;
  return {
    push: (p) => void (sec += p.length / 24000),
    silence: (s) => void (sec += s),
    get durationSec() {
      return sec;
    },
    checkpoint: () => ({ blob: new Blob([]), samples: 0 }),
    finish: () => new Blob([`mp3 ${sec.toFixed(1)}`], { type: 'audio/mpeg' }),
  };
};
const engine = { load: async () => ({ device: 'cpu', dtype: 'fp32' }), generate: async () => new Float32Array(24000) };
const memIndex = (): IndexStore => ({ all: async () => [], replace: async () => {} });

async function course() {
  const drive = new FakeDrive();
  const { storage } = makeStorage(drive);
  for (const [name, title] of [
    ['w3.md', 'Week 3'],
    ['w4.md', 'Week 4'],
  ]) {
    await storage.write(`Inbox/${name}`, `---\ntitle: ${title}\ncollection: ECON 1000\nmode: teach\n---\n## Notes\nSome notes.\n\n${GUIDE}`);
    const { itemPath } = await importMarkdown(storage, `Inbox/${name}`);
    await generateItem(itemPath, 'af_bella', { storage, engine, createWriter: fakeWriter, pending: memoryPending(), deviceName: 't' });
  }
  const index = new LibraryIndex(storage, memIndex());
  await index.refresh();
  return { drive, storage, index };
}

describe('quiz me', () => {
  it('builds one segment per review question across a collection, and can shuffle them', async () => {
    const { index } = await course();
    const segs = quizSegments(index.items);
    expect(segs).toHaveLength(4); // 2 questions × 2 items
    expect(segs.every((s) => s.end > s.start)).toBe(true);
    let seed = 1;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    expect(shuffle(segs, random).map((s) => s.start).sort()).toEqual(segs.map((s) => s.start).sort());
    expect(needsRegenerating(index.items)).toHaveLength(0);
  });
});

describe('course review', () => {
  it("makes an item from chapters of other items that plays and reads from their folders", async () => {
    const { storage, index } = await course();
    const [a, b] = index.items;
    const { itemPath, item } = await buildReview(storage, 'ECON 1000', 'Midterm review', [
      { entry: a, chapter: 3 },
      { entry: b, chapter: 3 },
    ]);
    expect(itemPath).toBe('Library/ECON 1000/Midterm review');
    expect(item.review).toBe(true);
    expect(item.status).toBe('ready');
    expect(item.chapters.map((c) => [c.n, c.src])).toEqual([
      [1, a.path],
      [2, b.path],
    ]);
    const saved = await readJson<Item>(storage, `${itemPath}/item.json`);
    const memCache = (): AudioCache => {
      const m = new Map<string, Blob>();
      return { match: async (k) => m.get(k), put: async (k, v) => void m.set(k, v), delete: async (k) => void m.delete(k) };
    };
    const texts = (): TextStore => ({ get: async () => undefined, put: async () => {}, delete: async () => {}, getRecords: async () => ({}), setRecords: async () => {} });
    const dl = new Downloads(storage, memCache(), texts());
    const entry = { path: itemPath, item: saved };
    expect(await (await dl.audio(entry, 2)).text()).toMatch(/^mp3 /);
    expect(await dl.text(entry, 1)).toContain('## Review questions');
    // Cues come along, so a review can be quizzed too.
    expect(quizSegments([entry])).toHaveLength(4);
  });

  it('refuses chapters that have no audio', async () => {
    const { storage, index } = await course();
    const broken = { ...index.items[0], item: { ...index.items[0].item, chapters: index.items[0].item.chapters.map((c) => ({ ...c, status: 'pending' as const })) } };
    await expect(buildReview(storage, 'ECON 1000', 'x', [{ entry: broken, chapter: 1 }])).rejects.toThrow(/no audio/);
  });
});

describe('Ask Claude for a study guide', () => {
  const item = { title: 'Week 3 reading', collection: 'ECON 1000', sources: ['reading.pdf'] } as Item;
  it('includes short text inline and names where to save guide.md', () => {
    const p = studyGuidePrompt('Library/ECON 1000/Week 3 reading', item, [{ title: 'One', markdown: '## One\n\nShort text.' }]);
    expect(p).toContain('Noteable/Library/ECON 1000/Week 3 reading/guide.md');
    expect(p).toContain('Short text.');
    expect(p).toContain('- **Term:** definition');
  });
  it('points at the Drive text files for long items', () => {
    const p = studyGuidePrompt('Library/X/Y', item, [{ title: 'Long', markdown: 'x'.repeat(INLINE_LIMIT + 1) }]);
    expect(p).toContain('Noteable/Library/X/Y/text/');
    expect(p).not.toContain('xxxxxxxxxx');
  });
});
