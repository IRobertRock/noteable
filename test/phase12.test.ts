import { describe, expect, it } from 'vitest';
import { CueRecorder } from '../src/generate/generateItem';
import type { IndexedItem } from '../src/library/libraryIndex';
import type { Chapter, Item } from '../src/model/item';
import { recapPlan } from '../src/player/recap';
import { indexWork, plainText, scoreText, searchAll, SearchIndexer, snippet, tokenize, type SearchDoc } from '../src/search/searchIndex';
import { cardsFromMarkdown } from '../src/study/cards';
import { notesMarkdown } from '../src/study/exportNotes';
import { collectTerms, glossaryMarkdown } from '../src/study/glossary';
import { cardsDue, coursePlan, daysUntil, examLabel } from '../src/study/plan';
import { quizSegments } from '../src/study/quiz';
import { scoreAnswer, stem } from '../src/study/speechAnswer';
import { mergeExams, type Bookmark, type PlaybackDoc } from '../src/sync/state';
import { FakeDrive, makeStorage } from './fakeDrive';

function chapter(n: number, extra: Partial<Chapter> = {}): Chapter {
  return { n, title: `Chapter ${n}`, textFile: `text/0${n}.md`, chars: 100, status: 'done', durationSec: 600, audioFile: `audio/0${n}.mp3`, ...extra };
}

function entry(id: string, extra: Partial<Item> = {}, chapters = [chapter(1), chapter(2)]): IndexedItem {
  const item: Item = {
    schema: 1,
    id,
    title: `Item ${id}`,
    collection: 'ECON 1000',
    mode: 'narrate',
    voice: 'af_bella',
    sources: [],
    chapters,
    status: 'ready',
    createdAt: `2026-09-0${id.length}T00:00:00Z`,
    updatedAt: '2026-10-01T00:00:00Z',
    ...extra,
  };
  return { path: `Library/ECON 1000/${item.title}`, item };
}

describe('search', () => {
  it('tokenises without stopwords and folds accents', () => {
    expect(tokenize('The Café of Opportunity-Cost!')).toEqual(['cafe', 'opportunity', 'cost']);
  });

  it('strips markdown to plain text', () => {
    expect(plainText('## Heading\n- **Term:** a [link](http://x) [pause 3s]\n')).toBe('Heading Term: a link');
  });

  it('needs every word, ranks the exact phrase higher, and finds word starts', () => {
    expect(scoreText('the cost of choosing', 'opportunity cost')).toBeNull();
    const phrase = scoreText('Opportunity cost is the value of the next best alternative.', 'opportunity cost')!;
    const apart = scoreText('Cost matters when an opportunity appears.', 'opportunity cost')!;
    expect(phrase.score).toBeGreaterThan(apart.score);
    expect(scoreText('Opportunities abound', 'opportun')).not.toBeNull();
    expect(scoreText('inopportune', 'opportun')).toBeNull();
  });

  it('cuts a snippet around the match on word boundaries', () => {
    const text = 'word '.repeat(40) + 'MATCH here ' + 'tail '.repeat(40);
    const s = snippet(text, text.indexOf('MATCH'));
    expect(s.startsWith('…')).toBe(true);
    expect(s.endsWith('…')).toBe(true);
    expect(s).toContain('MATCH here');
  });

  it('searches chapters and your notes, with notes first', () => {
    const a = entry('a');
    const docs = [{ doc: { key: 'a#2', itemId: 'a', chapter: 2, version: '', markdown: '' }, plain: 'The production possibilities frontier shows trade-offs.' }];
    const bookmarks: Bookmark[] = [
      { id: 'b1', itemId: 'a', chapter: 1, positionSec: 0, kind: 'highlight', text: 'A frontier of production', note: 'exam!', createdAt: '', updatedAt: '' },
      { id: 'b2', itemId: 'a', chapter: 1, positionSec: 42, note: 'production example', createdAt: '', updatedAt: '', deleted: true },
    ];
    const hits = searchAll('production frontier', docs, bookmarks, (id) => (id === 'a' ? a : undefined));
    expect(hits.map((h) => h.kind)).toEqual(['highlight', 'text']);
    expect(hits[0].find).toBe('A frontier of production');
    expect(hits[1].chapterTitle).toBe('Chapter 2');
  });

  it('fetches new and changed chapters, drops removed ones, and skips review items', () => {
    const a = entry('a', {}, [chapter(1), chapter(2, { excluded: true }), chapter(3)]);
    const review = entry('rv', { review: true });
    const stored = new Map<string, SearchDoc>([
      ['a#1', { key: 'a#1', itemId: 'a', chapter: 1, version: a.item.updatedAt, markdown: '' }],
      ['a#3', { key: 'a#3', itemId: 'a', chapter: 3, version: 'old', markdown: '' }],
      ['gone#1', { key: 'gone#1', itemId: 'gone', chapter: 1, version: '', markdown: '' }],
    ]);
    const work = indexWork([a, review], stored);
    expect(work.fetch.map((f) => f.chapter)).toEqual([3]);
    expect(work.drop).toEqual(['gone#1']);
  });

  it('the indexer stores fetched text and keeps going after a failed fetch', async () => {
    const saved = new Map<string, SearchDoc>();
    const store = { all: async () => [...saved.values()], put: async (d: SearchDoc) => void saved.set(d.key, d), delete: async (k: string) => void saved.delete(k) };
    const ix = new SearchIndexer(store, async (_e, n) => {
      if (n === 1) throw new Error('offline');
      return `## Two\nMarginal benefit.`;
    });
    await ix.update([entry('a')]);
    expect([...saved.keys()]).toEqual(['a#2']);
    expect(ix.progress).toEqual({ done: 1, total: 2 });
    expect((await ix.entries())[0].plain).toBe('Two Marginal benefit.');
  });
});

describe('spoken answers', () => {
  it('stems lightly', () => {
    expect(stem('costs')).toBe(stem('cost'));
    expect(stem('choosing')).toBe(stem('choose'));
    expect(stem('studies')).toBe('study');
  });

  it('scores by key-word overlap', () => {
    const expected = 'The value of the next best alternative given up.';
    expect(scoreAnswer('the value of the next best alternative', expected).score).toBe('right');
    expect(scoreAnswer('something about the best value', expected).score).toBe('close');
    expect(scoreAnswer('supply and demand', expected).score).toBe('missed');
    expect(scoreAnswer('', expected).score).toBe('missed');
  });

  it('cues record where the answer starts, and quiz segments carry it with their index', () => {
    const r = new CueRecorder();
    r.mark('q', 10);
    r.mark('a', 18);
    r.mark('q', 25);
    r.mark('a', 31);
    const cues = r.finish(40);
    expect(cues).toEqual([
      { start: 9.9, end: 25, answer: 18 },
      { start: 24.9, end: 40, answer: 31 },
    ]);
    const segs = quizSegments([entry('a', { mode: 'teach' }, [chapter(1, { cues })])]);
    expect(segs.map((s) => [s.index, s.answer])).toEqual([
      [0, 18],
      [1, 31],
    ]);
  });
});

describe('exam planning', () => {
  const now = new Date(2026, 9, 9, 15, 0); // Oct 9, 3 pm local

  it('counts whole days to the exam', () => {
    expect(daysUntil('2026-10-09', now)).toBe(0);
    expect(daysUntil('2026-10-10', now)).toBe(1);
    expect(daysUntil('2026-10-21', now)).toBe(12);
    expect(daysUntil('2026-10-01', now)).toBeLessThan(0);
    expect(examLabel(12)).toBe('exam in 12 days');
    expect(examLabel(1)).toBe('exam tomorrow');
  });

  it('spreads unlistened items across the days left, oldest first', () => {
    const items = ['a', 'bb', 'ccc', 'dddd', 'eeeee'].map((id) => entry(id));
    const playback: PlaybackDoc = { version: 1, items: { a: { chapter: 2, positionSec: 600, speed: 1, updatedAt: '', device: '' } } };
    const plan = coursePlan(items, playback, '2026-10-11', now)!;
    expect(plan.daysLeft).toBe(2);
    expect(plan.remaining.map((x) => x.item.id)).toEqual(['bb', 'ccc', 'dddd', 'eeeee']);
    expect(plan.today.map((x) => x.item.id)).toEqual(['bb', 'ccc']);
    expect(coursePlan(items, playback, '2026-10-01', now)).toBeNull();
  });

  it('cards due are those in box 1 or 2', () => {
    const cards = cardsFromMarkdown('a', 1, '- **One:** 1\n- **Two:** 2\n- **Three:** 3\n- **Four:** 4');
    const doc = { version: 1 as const, cards: { [cards[0].id]: { box: 1, updatedAt: '' }, [cards[1].id]: { box: 2, updatedAt: '' }, [cards[2].id]: { box: 4, updatedAt: '' } } };
    expect(cardsDue(cards, doc).map((c) => c.front)).toEqual(['One', 'Two']);
  });

  it('exam dates merge latest-wins per course', () => {
    const a = { version: 1 as const, exams: { ECON: { date: '2026-12-01', updatedAt: '2026-10-01' }, POLS: { date: '2026-12-05', updatedAt: '2026-10-05' } } };
    const b = { version: 1 as const, exams: { ECON: { date: '2026-12-03', updatedAt: '2026-10-02' }, POLS: { date: '', updatedAt: '2026-10-01' } } };
    expect(mergeExams(a, b).exams).toEqual({ ECON: { date: '2026-12-03', updatedAt: '2026-10-02' }, POLS: { date: '2026-12-05', updatedAt: '2026-10-05' } });
  });
});

describe('glossary', () => {
  const sources = [
    { title: 'Week 1', markdown: '## Terms\n- **Opportunity cost:** the next best alternative.\n- **Scarcity:** limited resources.\n' },
    { title: 'Week 2', markdown: '## Terms\n- **opportunity cost:** what you give up.\n- **Zebra:** z.\n- **3D printing:** additive.\n- **Scarcity:** limited resources.\n' },
  ];

  it('de-duplicates terms (first definition wins, different ones listed) and sorts them', () => {
    const terms = collectTerms(sources);
    expect(terms.map((t) => t.term)).toEqual(['3D printing', 'Opportunity cost', 'Scarcity', 'Zebra']);
    expect(terms[1]).toMatchObject({ definition: 'the next best alternative.', from: 'Week 1', also: [{ definition: 'what you give up.', from: 'Week 2' }] });
    expect(terms[2].also).toEqual([]);
  });

  it('writes a teach guide with one chapter per letter group, usable as flashcards', () => {
    const md = glossaryMarkdown('ECON 1000', collectTerms(sources));
    expect(md).toContain('title: ECON 1000 glossary');
    expect(md).toContain('mode: teach');
    expect(md.match(/^## .+$/gm)).toEqual(['## Terms 0–9', '## Terms K–O', '## Terms P–T', '## Terms U–Z']);
    expect(cardsFromMarkdown('g', 1, md).map((c) => c.front)).toEqual(['3D printing', 'Opportunity cost', 'Scarcity', 'Zebra']);
  });
});

describe('export notes', () => {
  it('lists highlights, bookmark notes and cards to work on', () => {
    const { item } = entry('a');
    const bookmarks: Bookmark[] = [
      { id: '1', itemId: 'a', chapter: 2, positionSec: 0, kind: 'highlight', text: 'Trade-offs everywhere', note: 'key idea', createdAt: '', updatedAt: '' },
      { id: '2', itemId: 'a', chapter: 1, positionSec: 75, note: 'example', createdAt: '', updatedAt: '' },
      { id: '3', itemId: 'a', chapter: 1, positionSec: 80, note: '', createdAt: '', updatedAt: '' },
      { id: '4', itemId: 'a', chapter: 1, positionSec: 90, note: 'deleted', createdAt: '', updatedAt: '', deleted: true },
    ];
    const again = cardsFromMarkdown('a', 1, '- **PPF:** production possibilities frontier');
    const md = notesMarkdown('Item a — notes', [{ item, bookmarks, again }], new Date(2026, 9, 9));
    expect(md).toContain('Exported from Noteable on 2026-10-09.');
    expect(md).toContain('- “Trade-offs everywhere” (Chapter 2)\n  - Note: key idea');
    expect(md).toContain('- Chapter 1, 1:15: example');
    expect(md).not.toContain('deleted');
    expect(md).toContain('- **PPF** — production possibilities frontier');
  });

  it('says so when there is nothing to export', () => {
    expect(notesMarkdown('x', [{ item: entry('a').item, bookmarks: [], again: [] }])).toContain('No highlights');
  });

  it('uploads as a Google Doc', async () => {
    const drive = new FakeDrive();
    const { storage } = makeStorage(drive);
    const doc = await storage.writeAsGoogleDoc!('Exports/ECON notes.md', '# Notes');
    expect(doc.url).toBe(`https://docs.google.com/document/d/${doc.id}/edit`);
    const file = drive.files.get(doc.id)!;
    expect(file.name).toBe('ECON notes');
    expect(file.mimeType).toBe('application/vnd.google-apps.document');
  });
});

describe('recap on return', () => {
  const now = new Date('2026-10-09T12:00:00Z');
  const saved = (daysAgo: number, ch = 2, pos = 300) => ({ chapter: ch, positionSec: pos, speed: 1, device: '', updatedAt: new Date(now.getTime() - daysAgo * 86_400_000).toISOString() });

  it('waits 3 days', () => {
    expect(recapPlan(entry('a'), saved(2), now)).toBeNull();
    expect(recapPlan(entry('a'), saved(3), now)).toMatchObject({ kind: 'rewind', chapter: 2, start: 240, daysAway: 3 });
  });

  it('uses a guide recap chapter when there is one', () => {
    const guide = entry('g', { mode: 'teach' }, [chapter(1), chapter(2), chapter(3, { title: 'Recap' })]);
    expect(recapPlan(guide, saved(5), now)).toMatchObject({ kind: 'chapter', chapter: 3, title: 'Recap' });
    // Already in the recap chapter: just the last minute.
    expect(recapPlan(guide, saved(5, 3), now)).toMatchObject({ kind: 'rewind', chapter: 3 });
  });

  it('skips items barely started', () => {
    expect(recapPlan(entry('a'), saved(10, 1, 10), now)).toBeNull();
    expect(recapPlan(entry('a'), undefined, now)).toBeNull();
  });
});
