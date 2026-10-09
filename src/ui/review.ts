// Build a review across a collection: tick chapters from several items; the new
// item plays them in order from their existing audio (nothing is regenerated).

import { itemHash, type App } from '../app';
import { buildReview, type ReviewPick } from '../study/review';
import { formatDuration } from './format';
import { fill, h } from './h';

export function reviewScreen(app: App, collection: string): HTMLElement {
  const picks: ReviewPick[] = [];
  const title = h('input', { type: 'text', value: `${collection} review`, 'aria-label': 'Review title' }) as HTMLInputElement;
  const status = h('p', { class: 'muted small' });
  const create = h('button', { class: 'primary', disabled: true }, 'Create review') as HTMLButtonElement;
  const items = app.library.items.filter((x) => x.item.collection === collection && !x.item.review && x.item.chapters.some((c) => c.status === 'done'));

  const update = () => {
    const secs = picks.reduce((n, p) => n + (p.entry.item.chapters.find((c) => c.n === p.chapter)?.durationSec ?? 0), 0);
    status.textContent = picks.length ? `${picks.length} chapter${picks.length > 1 ? 's' : ''} · ${formatDuration(secs)}` : 'Tick the chapters to include. They play in the order shown.';
    create.disabled = !picks.length;
  };

  create.addEventListener('click', async () => {
    create.disabled = true;
    status.textContent = 'Creating…';
    try {
      await app.reconnectNow();
      const { itemPath, item } = await buildReview(app.storage, collection, title.value, picks);
      await app.library.put({ path: itemPath, item });
      app.go(itemHash(itemPath));
    } catch (err) {
      status.textContent = (err as Error).message;
      create.disabled = false;
    }
  });

  const list = h(
    'div',
    null,
    items.map((x) =>
      h(
        'div',
        { class: 'review-item' },
        h('h3', null, x.item.title),
        x.item.chapters
          .filter((c) => c.status === 'done' && !c.excluded)
          .map((c) => {
            const box = h('input', { type: 'checkbox' }) as HTMLInputElement;
            box.addEventListener('change', () => {
              const i = picks.findIndex((p) => p.entry === x && p.chapter === c.n);
              if (box.checked && i < 0) picks.push({ entry: x, chapter: c.n });
              if (!box.checked && i >= 0) picks.splice(i, 1);
              update();
            });
            return h('label', { class: 'check' }, box, ` ${c.title}`, h('span', { class: 'muted small' }, ` · ${formatDuration(c.durationSec ?? 0)}${c.cues?.length ? ` · ${c.cues.length} questions` : ''}`));
          }),
      ),
    ),
  );

  const screen = h('section', { class: 'screen' }, h('h1', null, `Build a review: ${collection}`), title, list, status, create);
  if (!items.length) fill(list, h('p', { class: 'muted' }, 'No items with audio in this collection yet.'));
  update();
  return screen;
}
