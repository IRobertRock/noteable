// Flashcards from an item's key terms and review questions. Tap to flip;
// "Again" cards come back first next time (results sync through Drive).

import { itemHash, type App } from '../app';
import { cardsFromMarkdown, nextBox, orderCards, type Card } from '../study/cards';
import { fill, h } from './h';

export function flashcardsScreen(app: App, path: string): HTMLElement {
  const screen = h('section', { class: 'screen cards' }, h('p', { class: 'muted' }, 'Finding cards…'));
  const entry = app.library.byPath(path);
  if (!entry) {
    fill(screen, h('p', { class: 'error' }, 'This item is not in the library on this device yet.'));
    return screen;
  }
  let deck: Card[] = [];
  let i = 0;
  let flipped = false;
  let knew = 0;

  const render = () => {
    const head = h('p', { class: 'muted small' }, h('a', { href: itemHash(path) }, `${entry.item.collection} › ${entry.item.title}`));
    if (!deck.length) {
      fill(screen, head, h('h1', null, 'Flashcards'), h('p', { class: 'muted' }, 'No cards here. Cards come from "Key terms" lines like "- **Term:** definition" and from **Q:** / **A:** review questions in a study guide.'));
      return;
    }
    if (i >= deck.length) {
      fill(
        screen,
        head,
        h('h1', null, 'Done'),
        h('p', null, `You knew ${knew} of ${deck.length}. Cards you marked "Again" come first next time.`),
        h('div', { class: 'buttons' }, h('button', { class: 'primary', onclick: () => void start() }, 'Go again'), h('button', { onclick: () => app.go(itemHash(path)) }, 'Back to the item')),
      );
      return;
    }
    const c = deck[i];
    const box = app.state.cards.cards[c.id]?.box;
    const rate = async (k: boolean) => {
      if (k) knew++;
      await app.state.setCardBox(c.id, nextBox(box, k));
      i++;
      flipped = false;
      render();
      if (i >= deck.length) void app.state.sync().catch(() => {});
    };
    fill(
      screen,
      head,
      h('p', { class: 'muted small' }, `Card ${i + 1} of ${deck.length} · ${c.kind === 'term' ? 'Key term' : 'Review question'}${box ? ` · box ${box}` : ' · new'}`),
      h(
        'button',
        { class: `card ${flipped ? 'flipped' : ''}`, 'aria-live': 'polite', onclick: () => ((flipped = !flipped), render()) },
        h('div', { class: 'card-front' }, c.front),
        flipped ? h('div', { class: 'card-back' }, c.back) : h('div', { class: 'muted small' }, 'Tap to show the answer'),
      ),
      flipped &&
        h(
          'div',
          { class: 'buttons' },
          h('button', { onclick: () => void rate(false) }, '↺ Again'),
          h('button', { class: 'primary', onclick: () => void rate(true) }, '✓ Knew it'),
        ),
    );
  };

  const start = async () => {
    const all: Card[] = [];
    for (const ch of entry.item.chapters.filter((c) => !c.excluded)) {
      const md = await app.downloads.text(entry, ch.n).catch(() => '');
      all.push(...cardsFromMarkdown(entry.item.id, ch.n, md));
    }
    deck = orderCards(all, app.state.cards);
    i = 0;
    knew = 0;
    flipped = false;
    render();
  };

  void start().catch((err) => fill(screen, h('p', { class: 'error' }, (err as Error).message)));
  return screen;
}
