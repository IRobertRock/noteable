// Study actions shared by the Library and item pages: export notes, make a
// course glossary, and score spoken Quiz me answers.

import { itemHash, type App } from '../app';
import { importMarkdown } from '../import/importMarkdown';
import type { IndexedItem } from '../library/libraryIndex';
import type { AnswerResult } from '../player/player';
import { cardsFromMarkdown, type Card } from '../study/cards';
import { notesMarkdown } from '../study/exportNotes';
import { collectTerms, glossaryMarkdown } from '../study/glossary';
import type { QuizSegment } from '../study/quiz';
import { listenOnce, scoreAnswer } from '../study/speechAnswer';
import { nextBox } from '../study/cards';
import { h } from './h';

/** Every flashcard in an item (teach items only), from its chapter text. */
export async function itemCards(app: App, entry: IndexedItem): Promise<Card[]> {
  if (entry.item.mode !== 'teach') return [];
  const out: Card[] = [];
  for (const c of entry.item.chapters.filter((x) => !x.excluded)) {
    const md = await app.downloads.text(entry, c.n).catch(() => '');
    out.push(...cardsFromMarkdown(entry.item.id, c.n, md));
  }
  return out;
}

const stamp = (d = new Date()) => `${d.toLocaleDateString('en-CA')} ${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;

/** A button that exports notes for the given items and then shows a link to the Doc. */
export function exportNotesButton(app: App, title: string, entries: () => IndexedItem[]): HTMLElement {
  const status = h('span', { class: 'muted small' });
  const btn = h('button', { class: 'small' }, '📝 Export notes') as HTMLButtonElement;
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    status.textContent = 'Exporting…';
    try {
      await app.reconnectNow();
      const sources = [];
      for (const entry of entries()) {
        const again = (await itemCards(app, entry)).filter((c) => app.state.cards.cards[c.id]?.box === 1);
        sources.push({ item: entry.item, bookmarks: app.state.bookmarksFor(entry.item.id), again });
      }
      const md = notesMarkdown(`${title} — notes`, sources);
      const path = `Exports/${title.replace(/[\\/:*?"<>|]/g, '-')} notes ${stamp()}.md`;
      if (app.storage.writeAsGoogleDoc) {
        const doc = await app.storage.writeAsGoogleDoc(path, md);
        status.replaceChildren('Saved to Noteable/Exports. ', h('a', { href: doc.url, target: '_blank', rel: 'noopener' }, 'Open the Google Doc'));
      } else {
        await app.storage.write(path, md, 'text/markdown');
        status.textContent = `Saved ${path}.`;
      }
    } catch (err) {
      status.textContent = `Couldn't export: ${(err as Error).message}`;
    } finally {
      btn.disabled = false;
    }
  });
  return h('span', { class: 'inline-action' }, btn, ' ', status);
}

/** Builds "<course> glossary" from the course's guides and opens the new item. */
export function glossaryButton(app: App, course: string, entries: () => IndexedItem[]): HTMLElement {
  const status = h('span', { class: 'muted small' });
  const btn = h('button', { class: 'small' }, '📖 Make glossary') as HTMLButtonElement;
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    status.textContent = 'Collecting key terms…';
    try {
      await app.reconnectNow();
      const sources: { title: string; markdown: string }[] = [];
      for (const entry of entries().filter((x) => x.item.mode === 'teach' && !x.item.review && !/ glossary$/i.test(x.item.title))) {
        for (const c of entry.item.chapters.filter((x) => !x.excluded)) sources.push({ title: entry.item.title, markdown: await app.downloads.text(entry, c.n).catch(() => '') });
      }
      const terms = collectTerms(sources);
      if (!terms.length) {
        status.textContent = 'No key terms found. Study guides list them as "- **Term:** definition".';
        return;
      }
      const inbox = `Inbox/${course.replace(/[\\/:*?"<>|]/g, '-')} glossary.md`;
      await app.storage.write(inbox, glossaryMarkdown(course, terms), 'text/markdown');
      const { itemPath } = await importMarkdown(app.storage, inbox, await app.defaultVoice());
      await app.library.refresh();
      app.go(itemHash(itemPath));
    } catch (err) {
      status.textContent = `Couldn't make the glossary: ${(err as Error).message}`;
    } finally {
      btn.disabled = false;
    }
  });
  return h('span', { class: 'inline-action' }, btn, ' ', status);
}

/** Player hook for Say your answer: listen, score against the written answer, update the card's box. */
export function spokenAnswerHook(app: App): (seg: QuizSegment) => Promise<AnswerResult | null> {
  return async (seg) => {
    const md = await app.downloads.text(seg.entry, seg.chapter);
    const qa = cardsFromMarkdown(seg.entry.item.id, seg.chapter, md).filter((c) => c.kind === 'qa')[seg.index];
    if (!qa) return null;
    const said = await listenOnce();
    const { score } = scoreAnswer(said, qa.back);
    if (score !== 'close') await app.state.setCardBox(qa.id, nextBox(app.state.cards.cards[qa.id]?.box, score === 'right'));
    return { said, expected: qa.back, score };
  };
}
