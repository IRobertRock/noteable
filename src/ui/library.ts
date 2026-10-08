// Simple library list for phase 2. Phase 3 replaces this with a synced local index.

import { ITEM_FILE, itemDuration, type Item } from '../model/item';
import { readJson, type Storage } from '../storage/Storage';
import { formatDuration } from './format';
import { h } from './h';

export function libraryScreen(ctx: { storage: Storage; openItem: (path: string) => void }): HTMLElement {
  const body = h('div', null, h('p', { class: 'muted' }, 'Loading…'));
  const screen = h('section', { class: 'screen' }, h('h1', null, 'Library'), body);

  (async () => {
    try {
      const collections = (await ctx.storage.list('Library')).filter((e) => e.kind === 'folder');
      collections.sort((a, b) => a.name.localeCompare(b.name));
      const groups: HTMLElement[] = [];
      for (const col of collections) {
        const folders = (await ctx.storage.list(col.path)).filter((e) => e.kind === 'folder');
        const items = await Promise.all(
          folders.map(async (f) => ({ path: f.path, item: await readJson<Item>(ctx.storage, `${f.path}/${ITEM_FILE}`).catch(() => null) })),
        );
        const rows = items
          .filter((x): x is { path: string; item: Item } => !!x.item)
          .sort((a, b) => b.item.updatedAt.localeCompare(a.item.updatedAt))
          .map(({ path, item }) => itemRow(path, item, ctx.openItem));
        groups.push(h('h2', null, col.name), rows.length ? h('div', { class: 'list' }, rows) : h('p', { class: 'muted small' }, 'Empty'));
      }
      body.replaceChildren(...groups);
    } catch (err) {
      body.replaceChildren(h('p', { class: 'error' }, (err as Error).message));
    }
  })();

  return screen;
}

const STATUS: Record<Item['status'], string> = { draft: 'Not generated', generating: 'Generating', ready: 'Ready', error: 'Error' };

function itemRow(path: string, item: Item, open: (p: string) => void): HTMLElement {
  const done = item.chapters.filter((c) => c.status === 'done').length;
  const detail =
    item.status === 'ready'
      ? `${item.chapters.length} chapters · ${formatDuration(itemDuration(item))}`
      : `${done}/${item.chapters.length} chapters done`;
  return h(
    'button',
    { class: 'row link', onclick: () => open(path) },
    h('div', { class: 'grow' }, h('div', { class: 'name' }, item.title), h('div', { class: 'muted small' }, `${item.mode === 'teach' ? 'Teach' : 'Narrate'} · ${detail}`)),
    h('span', { class: `pill ${item.status === 'ready' ? 'found' : item.status === 'error' ? 'error' : 'created'}` }, STATUS[item.status]),
  );
}
