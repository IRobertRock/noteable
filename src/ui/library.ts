// Library: collections and their items, from the local index (works offline),
// refreshed from Drive on open and every 2 minutes while visible.

import { itemHash, type App } from '../app';
import type { IndexedItem } from '../library/libraryIndex';
import { itemDuration, type Item } from '../model/item';
import { listenedFraction } from '../player/player';
import { continueListening } from '../library/continue';
import { quizSegments, shuffle } from '../study/quiz';
import { formatDuration } from './format';
import { fill, h } from './h';

const REFRESH_MS = 120_000;

export function libraryScreen(app: App): HTMLElement {
  const status = h('p', { class: 'muted small' });
  const shelf = h('div');
  const body = h('div');
  const refreshBtn = h('button', { class: 'small', onclick: () => void refresh() }, 'Refresh');
  const screen = h('section', { class: 'screen' }, h('div', { class: 'title-row' }, h('h1', null, 'Library'), refreshBtn), status, shelf, body);

  const render = () => {
    const items = app.library.items;
    const resume = continueListening(items, app.state.playback);
    fill(
      shelf,
      resume.length > 0 && [
        h('h2', null, 'Continue listening'),
        h(
          'div',
          { class: 'shelf' },
          resume.map((x) => {
            const pos = app.state.position(x.item.id)!;
            const ch = x.item.chapters.find((c) => c.n === pos.chapter);
            return h(
              'button',
              { class: 'shelf-card', onclick: () => void app.player.open(x).then(() => app.go('#/player')) },
              h('div', { class: 'name' }, x.item.title),
              h('div', { class: 'muted small' }, `${ch ? `Ch ${ch.n}` : ''} · ${Math.round(listenedFraction(x, pos.chapter, pos.positionSec) * 100)}%`),
              h('span', { class: 'shelf-play' }, '▶ Resume'),
            );
          }),
        ),
      ],
    );
    const byCollection = new Map<string, IndexedItem[]>();
    for (const c of app.library.collections) byCollection.set(c, []);
    for (const x of items) byCollection.set(x.item.collection, [...(byCollection.get(x.item.collection) ?? []), x]);
    const names = [...byCollection.keys()].sort((a, b) => (a === 'General' ? -1 : b === 'General' ? 1 : a.localeCompare(b)));

    if (!items.length) {
      fill(body, h('p', { class: 'muted' }, app.library.lastSynced ? 'No items yet. Import something from the Inbox.' : 'Loading…'));
    } else {
      fill(
        body,
        names.flatMap((name) => {
          const rows = (byCollection.get(name) ?? []).sort((a, b) => b.item.updatedAt.localeCompare(a.item.updatedAt));
          const segs = quizSegments(rows);
          const withAudio = rows.filter((x) => !x.item.review && x.item.chapters.some((c) => c.status === 'done')).length;
          return [
            h(
              'div',
              { class: 'collection-head' },
              h('h2', null, name),
              segs.length > 0 && h('button', { class: 'small', onclick: () => void app.player.startQuiz(shuffle(segs)).then(() => app.go('#/player')) }, `🎧 Quiz me (${segs.length})`),
              withAudio > 1 && h('button', { class: 'small', onclick: () => app.go(`#/review/${encodeURIComponent(name)}`) }, 'Build a review'),
            ),
            rows.length ? h('div', { class: 'list' }, rows.map((x) => itemRow(app, x))) : h('p', { class: 'muted small' }, 'Empty'),
          ];
        }),
      );
    }
    status.textContent = app.library.lastSynced ? `Updated ${app.library.lastSynced.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : navigator.onLine ? 'Checking Drive…' : 'Offline — showing what this device knows.';
  };

  const refresh = async () => {
    if (!navigator.onLine) return render();
    refreshBtn.setAttribute('disabled', '');
    try {
      await Promise.all([app.library.refresh(), app.state.sync()]);
    } catch (err) {
      status.textContent = `Couldn't reach Drive: ${(err as Error).message}`;
    } finally {
      refreshBtn.removeAttribute('disabled');
    }
  };

  app.onLeave(app.library.onChange(render));
  app.onLeave(app.downloads.onChange(render));
  app.onLeave(app.state.onChange(render));
  const timer = setInterval(() => document.visibilityState === 'visible' && void refresh(), REFRESH_MS);
  app.onLeave(() => clearInterval(timer));

  render();
  void refresh();
  return screen;
}

const STATUS: Record<Item['status'], string> = { draft: 'Not generated', generating: 'Generating', ready: 'Ready', error: 'Error' };

function itemRow(app: App, entry: IndexedItem): HTMLElement {
  const { item, path } = entry;
  const done = item.chapters.filter((c) => c.status === 'done').length;
  const pos = app.state.position(item.id);
  const listened = pos ? Math.round(listenedFraction(entry, pos.chapter, pos.positionSec) * 100) : 0;
  const downloaded = app.downloads.isDownloaded(item) && done > 0;
  const detail =
    item.status === 'ready'
      ? `${formatDuration(itemDuration(item))}${listened ? ` · ${listened}% listened` : ''}`
      : `${done}/${item.chapters.length} chapters generated`;
  return h(
    'button',
    { class: 'row link', onclick: () => app.go(itemHash(path)) },
    h(
      'div',
      { class: 'grow' },
      h('div', { class: 'name' }, item.title),
      h('div', { class: 'muted small' }, `${item.mode === 'teach' ? 'Teach' : 'Narrate'} · ${detail}`),
      listened > 0 && h('progress', { max: 100, value: listened }),
    ),
    downloaded && h('span', { class: 'pill found', title: 'Downloaded on this device' }, '⬇ Offline'),
    item.status !== 'ready' && h('span', { class: `pill ${item.status === 'error' ? 'error' : 'created'}` }, STATUS[item.status]),
  );
}
