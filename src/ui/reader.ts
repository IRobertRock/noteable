// Reading view: the same chapters as the audio, with formatting. Tapping a
// paragraph plays that chapter.

import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { itemHash, type App } from '../app';
import { formatDuration } from './format';
import { fill, h } from './h';

export function readerScreen(app: App, path: string): HTMLElement {
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
        h(
          'button',
          { class: 'margin-note', onclick: (e: Event) => (e.stopPropagation(), void app.player.open(entry, b.chapter, b.positionSec)) },
          `🔖 ${formatDuration(b.positionSec)}${b.note ? ` — ${b.note}` : ''}`,
        ),
      );

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
      const section = h('section', { class: 'chapter', 'data-chapter': c.n }, h('aside', { class: 'margin' }, bookmarksFor(c.n)), body);
      if (c.status === 'done') {
        section.addEventListener('click', (e) => {
          if ((e.target as HTMLElement).closest('a, button, input')) return;
          if (!(e.target as HTMLElement).closest('p, li, h2, h3, blockquote, td')) return;
          void app.player.open(entry, c.n, 0);
        });
      } else {
        section.classList.add('no-audio');
      }
      sections.set(c.n, section);
      parts.push(section);
    }
    fill(screen, ...parts);
    markCurrent();
  })();

  app.onLeave(app.player.onChange(markCurrent));
  return screen;
}
