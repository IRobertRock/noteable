// Search: chapter text of every item, plus your highlights and bookmark notes.

import { readHashAt, type App } from '../app';
import { queryTerms, searchAll, type SearchHit } from '../search/searchIndex';
import { formatDuration } from './format';
import { fill, h } from './h';

let lastQuery = '';

export function searchScreen(app: App): HTMLElement {
  const input = h('input', { type: 'search', placeholder: 'Words or a phrase', 'aria-label': 'Search', value: lastQuery, enterkeyhint: 'search' }) as HTMLInputElement;
  const status = h('p', { class: 'muted small' });
  const results = h('div', { class: 'list' });
  const screen = h('section', { class: 'screen' }, h('h1', null, 'Search'), input, status, results);

  const showStatus = () => {
    const { done, total } = app.search.progress;
    status.textContent = total && done < total ? `Indexed ${done} of ${total} chapters. Results grow as the rest are fetched.` : total ? `Searching ${total} chapters, your highlights and bookmark notes.` : '';
  };

  let seq = 0;
  const run = async () => {
    const q = input.value.trim();
    lastQuery = q;
    const mine = ++seq;
    if (q.length < 2) {
      fill(results);
      return showStatus();
    }
    const hits = searchAll(q, await app.search.entries(), app.state.bookmarks.bookmarks, (id) => app.library.byId(id));
    if (mine !== seq) return;
    showStatus();
    fill(results, hits.length ? hits.map((x) => hitRow(app, x, q)) : h('p', { class: 'muted' }, 'Nothing found.'));
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => void run(), 200);
  });

  // Fetch any chapters not yet indexed, refreshing results as they arrive.
  const index = async () => {
    for (let i = 0; i < 20; i++) {
      const before = app.search.progress.done;
      await app.search.update(app.library.items, 40, showStatus);
      await run();
      const { done, total } = app.search.progress;
      if (done >= total || done === before) break;
    }
  };
  void index();
  setTimeout(() => input.focus(), 50);
  return screen;
}

function hitRow(app: App, x: SearchHit, q: string): HTMLElement {
  const { entry } = x;
  const playable = entry.item.chapters.some((c) => c.n === x.chapter && c.status === 'done');
  const label = x.kind === 'highlight' ? '✎ Highlight' : x.kind === 'bookmark' ? `🔖 ${formatDuration(x.positionSec ?? 0)}` : '';
  return h(
    'div',
    { class: 'row search-hit' },
    h(
      'div',
      { class: 'grow' },
      h('div', { class: 'name' }, entry.item.title),
      h('div', { class: 'muted small' }, `${entry.item.collection} · ${x.chapterTitle}${label ? ` · ${label}` : ''}`),
      h('p', { class: 'snippet' }, marked(x.snippet, q)),
      h(
        'div',
        { class: 'buttons' },
        h('button', { class: 'small', onclick: () => app.go(readHashAt(entry.path, x.chapter, x.find ?? q)) }, 'Read'),
        playable && h('button', { class: 'small', onclick: () => void app.player.open(entry, x.chapter, x.positionSec ?? 0).then(() => app.go('#/player')) }, x.kind === 'bookmark' ? '▶ Play from here' : '▶ Play chapter'),
      ),
    ),
  );
}

/** Snippet with the query words wrapped in <mark> (built as nodes, never HTML). */
function marked(text: string, q: string): (Node | string)[] {
  const terms = queryTerms(q);
  if (!terms.length) return [text];
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})[\\p{L}\\p{N}]*`, 'giu');
  const out: (Node | string)[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    out.push(text.slice(last, m.index));
    out.push(h('mark', null, m[0]));
    last = m.index! + m[0].length;
  }
  out.push(text.slice(last));
  return out;
}
