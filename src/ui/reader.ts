// Reading view: the same chapters as the audio, with formatting. Tapping a
// paragraph plays that chapter.

import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { itemHash, type App } from '../app';
import { formatDuration } from './format';
import { fill, h } from './h';

export function readerScreen(app: App, path: string, openChapter?: number, find?: string): HTMLElement {
  const screen = h('section', { class: 'screen reader' }, h('p', { class: 'muted' }, 'Loading…'));
  const entry = app.library.byPath(path);
  if (!entry) {
    fill(screen, h('p', { class: 'error' }, 'This item is not in the library on this device yet. Open the Library to refresh.'));
    return screen;
  }
  const { item } = entry;
  const sections = new Map<number, HTMLElement>();

  const markCurrent = () => {
    const playing = app.player.entry?.item.id === item.id ? app.player.chapter : null;
    for (const [n, el] of sections) el.classList.toggle('current', n === playing);
  };

  const bookmarksFor = (n: number) =>
    app.state
      .bookmarksFor(item.id)
      .filter((b) => b.chapter === n)
      .map((b) =>
        b.kind === 'highlight'
          ? h(
              'button',
              { class: 'margin-note highlight-note', onclick: (e: Event) => e.stopPropagation() },
              `✎ ${b.note || `“${(b.text ?? '').slice(0, 60)}${(b.text ?? '').length > 60 ? '…' : ''}”`}`,
            )
          : h(
              'button',
              { class: 'margin-note', onclick: (e: Event) => (e.stopPropagation(), void app.player.open(entry, b.chapter, b.positionSec)) },
              `🔖 ${formatDuration(b.positionSec)}${b.note ? ` — ${b.note}` : ''}`,
            ),
      );

  const showHighlights = (n: number, body: HTMLElement) => {
    for (const b of app.state.bookmarksFor(item.id)) if (b.kind === 'highlight' && b.chapter === n && b.text) markText(body, b.text);
  };

  const highlightButton = h('button', { class: 'primary highlight-button', hidden: true }, '✎ Highlight') as HTMLButtonElement;
  (async () => {
    const parts: HTMLElement[] = [h('p', { class: 'muted small' }, h('a', { href: itemHash(path) }, `${item.collection} › ${item.title}`)), h('h1', null, item.title)];
    for (const c of item.chapters.filter((x) => !x.excluded)) {
      let html: string;
      try {
        html = DOMPurify.sanitize(await marked.parse(await app.downloads.text(entry, c.n)));
      } catch (err) {
        html = `<h2>${DOMPurify.sanitize(c.title)}</h2><p class="error">${DOMPurify.sanitize((err as Error).message)}</p>`;
      }
      const body = h('div', { class: 'prose' });
      body.innerHTML = html;
      tidyGuide(body);
      const section = h('section', { class: 'chapter', 'data-chapter': c.n }, h('aside', { class: 'margin' }, bookmarksFor(c.n)), body);
      if (c.status === 'done') {
        section.addEventListener('click', (e) => {
          if ((e.target as HTMLElement).closest('a, button, input, .answer')) return;
          if (!(e.target as HTMLElement).closest('p, li, h2, h3, blockquote, td')) return;
          void app.player.open(entry, c.n, 0);
        });
      } else {
        section.classList.add('no-audio');
      }
      sections.set(c.n, section);
      showHighlights(c.n, body);
      parts.push(section);
    }
    fill(screen, ...parts, highlightButton);
    markCurrent();
    if (openChapter !== undefined) scrollToFind(sections.get(openChapter), find);
  })();

  // Highlights: select text in a chapter, then tap ✎ Highlight.
  const selected = () => {
    const sel = document.getSelection();
    const text = sel?.toString().replace(/\s+/g, ' ').trim() ?? '';
    const node = sel?.anchorNode instanceof Element ? sel.anchorNode : sel?.anchorNode?.parentElement;
    const section = node?.closest<HTMLElement>('section.chapter');
    return text.length >= 3 && section && screen.contains(section) ? { text, chapter: Number(section.dataset.chapter), section } : null;
  };
  const onSelection = () => {
    highlightButton.hidden = !selected();
  };
  document.addEventListener('selectionchange', onSelection);
  app.onLeave(() => document.removeEventListener('selectionchange', onSelection));
  highlightButton.addEventListener('pointerdown', (e) => e.preventDefault()); // keep the selection
  highlightButton.addEventListener('click', async () => {
    const s = selected();
    if (!s) return;
    const note = prompt('Add a note to this highlight (optional):') ?? '';
    await app.state.addHighlight(item.id, s.chapter, s.text, note.trim());
    markText(s.section.querySelector('.prose')!, s.text);
    s.section.querySelector('aside.margin')?.replaceChildren(...bookmarksFor(s.chapter));
    document.getSelection()?.removeAllRanges();
    highlightButton.hidden = true;
    void app.state.sync().catch(() => {});
  });

  app.onLeave(app.player.onChange(markCurrent));
  return screen;
}

/** Scrolls to the first block in the chapter containing all the words of `find` (else the chapter). */
function scrollToFind(section: HTMLElement | undefined, find?: string): void {
  if (!section) return;
  let target: HTMLElement = section;
  if (find) {
    const words = find.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
    const phrase = find.toLowerCase().replace(/\s+/g, ' ').trim();
    const blocks = Array.from(section.querySelectorAll<HTMLElement>('p, li, blockquote, td, h2, h3'));
    const text = (b: HTMLElement) => (b.textContent ?? '').toLowerCase().replace(/\s+/g, ' ');
    const hit = blocks.find((b) => text(b).includes(phrase)) ?? blocks.find((b) => words.every((w) => text(b).includes(w)));
    if (hit) {
      hit.classList.add('found');
      target = hit;
    }
  }
  requestAnimationFrame(() => target.scrollIntoView({ block: 'center' }));
}

/** Wraps the first occurrence of `text` (within one paragraph) in <mark>. */
export function markText(root: HTMLElement, text: string): boolean {
  const target = text.replace(/\s+/g, ' ').trim();
  for (const block of Array.from(root.querySelectorAll('p, li, blockquote, td, h2, h3'))) {
    const flat = (block.textContent ?? '').replace(/\s+/g, ' ');
    const at = flat.indexOf(target);
    if (at < 0) continue;
    // Walk text nodes to find the start and end positions.
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let pos = 0;
    let start: { node: Text; offset: number } | null = null;
    let end: { node: Text; offset: number } | null = null;
    for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
      const len = (n.textContent ?? '').replace(/\s+/g, ' ').length;
      if (!start && at < pos + len) start = { node: n, offset: at - pos };
      if (start && at + target.length <= pos + len) {
        end = { node: n, offset: at + target.length - pos };
        break;
      }
      pos += len;
    }
    if (!start || !end) return false;
    try {
      const range = document.createRange();
      range.setStart(start.node, Math.min(start.offset, start.node.length));
      range.setEnd(end.node, Math.min(end.offset, end.node.length));
      const mark = document.createElement('mark');
      mark.append(range.extractContents());
      range.insertNode(mark);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Study-guide touches for reading: hide [pause Ns] markers, and hide each
 * **A:** answer behind a tap so the review questions work as a self-quiz.
 */
export function tidyGuide(root: HTMLElement): void {
  const hasMarker = /\[pause\s+\d+(?:\.\d+)?\s*s(?:ec(?:onds?)?)?\]/i;
  const markers = /\s*\[pause\s+\d+(?:\.\d+)?\s*s(?:ec(?:onds?)?)?\]\s*/gi;
  for (const p of Array.from(root.querySelectorAll('p, li'))) {
    const text = p.textContent ?? '';
    if (!hasMarker.test(text)) continue;
    if (!text.replace(markers, '').trim()) {
      p.remove();
      continue;
    }
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) n.textContent = (n.textContent ?? '').replace(markers, ' ');
  }
  for (const strong of Array.from(root.querySelectorAll('strong'))) {
    if (!/^A:?$/i.test(strong.textContent?.trim() ?? '')) continue;
    const block = strong.closest('p, li');
    if (!block || block.classList.contains('answer')) continue;
    if (block.firstElementChild !== strong) {
      // "**Q:** … **A:** …" in one paragraph: move the answer into its own paragraph.
      const answer = document.createElement('p');
      let node: ChildNode | null = strong;
      while (node) {
        const next: ChildNode | null = node.nextSibling;
        answer.append(node);
        node = next;
      }
      block.after(answer);
      makeAnswer(answer);
    } else {
      makeAnswer(block as HTMLElement);
    }
  }
}

function makeAnswer(el: HTMLElement): void {
  el.classList.add('answer', 'hidden-answer');
  el.setAttribute('role', 'button');
  el.setAttribute('tabindex', '0');
  el.setAttribute('aria-label', 'Show answer');
  const reveal = () => {
    el.classList.remove('hidden-answer');
    el.removeAttribute('role');
    el.removeAttribute('aria-label');
  };
  el.addEventListener('click', reveal);
  el.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && reveal());
}
