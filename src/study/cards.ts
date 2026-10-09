// Flashcards from study guides: **Term:** definition list items, and **Q:** / **A:** pairs.
// Results use simple Leitner boxes (1–5): "again" sends a card to box 1, "knew it"
// moves it up; lower boxes come first next time.

import type { CardsDoc } from '../sync/state';

export interface Card {
  id: string;
  front: string;
  back: string;
  chapter: number;
  kind: 'term' | 'qa';
}

/** Stable id from the item and the card's front, so results survive regeneration. */
export function cardId(itemId: string, front: string): string {
  let h = 0x811c9dc5;
  const s = `${itemId}|${front.toLowerCase().trim()}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

const clean = (s: string) =>
  s
    .replace(/\[pause\s+[\d.]+\s*s\w*\]/gi, '')
    .replace(/\*\*|__|\*|_|`/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** Finds cards in one chapter's markdown. */
export function cardsFromMarkdown(itemId: string, chapter: number, markdown: string): Card[] {
  const cards: Card[] = [];
  const add = (kind: Card['kind'], front: string, back: string) => {
    const f = clean(front);
    const b = clean(back);
    if (f && b && !cards.some((c) => c.front === f)) cards.push({ id: cardId(itemId, f), front: f, back: b, chapter, kind });
  };

  // Terms: "- **Opportunity cost:** the value of …" (colon inside or just after the bold).
  for (const m of markdown.matchAll(/^\s*[-*+]\s+\*\*([^*\n]+?):?\*\*:?\s*(.+)$/gm)) {
    if (/^[QA]$/i.test(m[1].trim())) continue;
    add('term', m[1], m[2]);
  }

  // Q/A pairs: a question, then the next answer (possibly after a pause marker or in the same paragraph).
  const qa = /\*\*Q:?\*\*:?\s*([\s\S]*?)\s*(?:\[pause[^\]]*\]\s*)?\*\*A:?\*\*:?\s*([\s\S]*?)(?=\n\s*\n\s*(?:\*\*Q|#)|\n#|$)/g;
  for (const m of markdown.matchAll(qa)) add('qa', m[1], m[2].split(/\n\s*\n/)[0]);
  return cards;
}

/** Due order: lowest box first; unseen cards (box 0) before box 2+; ties keep guide order. */
export function orderCards(cards: Card[], doc: CardsDoc): Card[] {
  const box = (c: Card) => doc.cards[c.id]?.box ?? 0;
  const rank = (b: number) => (b === 1 ? 0 : b === 0 ? 1 : b);
  return cards.map((c, i) => ({ c, i })).sort((a, b) => rank(box(a.c)) - rank(box(b.c)) || a.i - b.i).map((x) => x.c);
}

export function nextBox(current: number | undefined, knewIt: boolean): number {
  return knewIt ? Math.min(5, Math.max(1, current ?? 0) + 1) : 1;
}
