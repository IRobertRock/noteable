// Import from Zotero: browse your library by collection or search, and import
// an item's stored PDF through the normal document pipeline.

import type { App } from '../app';
import { readSettings } from '../settings';
import { ZoteroClient, type ZoteroCollection, type ZoteroItem } from '../zotero/client';
import { fill, h } from './h';
import { runImport } from './importRun';

export function zoteroScreen(app: App): HTMLElement {
  const body = h('div', null, h('p', { class: 'muted' }, 'Connecting to Zotero…'));
  const screen = h('section', { class: 'screen' }, h('h1', null, 'Import from Zotero'), body);
  let client: ZoteroClient;
  let collections: ZoteroCollection[] = [];
  let collection = '';
  let q = '';
  const list = h('div');

  const load = async () => {
    fill(list, h('p', { class: 'muted' }, 'Loading…'));
    try {
      const items = await client.items({ collection: collection || undefined, q });
      fill(list, items.length ? h('div', { class: 'list' }, items.map(row)) : h('p', { class: 'muted' }, 'No items found.'));
    } catch (err) {
      fill(list, h('p', { class: 'error' }, (err as Error).message));
    }
  };

  const row = (it: ZoteroItem) => {
    const status = h('div', { class: 'muted small' });
    const button = h('button', { class: 'primary small', disabled: !it.hasChildren }, it.hasChildren ? 'Import' : 'No PDF') as HTMLButtonElement;
    button.addEventListener('click', async () => {
      button.disabled = true;
      status.textContent = 'Finding the PDF…';
      try {
        const pdf = (await client.attachments(it.key)).find((a) => a.downloadable && /pdf/i.test(a.contentType));
        if (!pdf) throw new Error('This item has no PDF stored in Zotero.');
        status.textContent = `Downloading ${pdf.filename}…`;
        const file = await client.download(pdf);
        status.textContent = '';
        await runImport(app, [{ kind: 'upload', file }], {
          title: it.title,
          extra: { zotero: { key: it.key, authors: it.authors, year: it.year, publication: it.publication } },
        });
      } catch (err) {
        status.textContent = (err as Error).message;
        status.className = 'error small';
      } finally {
        button.disabled = false;
      }
    });
    return h(
      'div',
      { class: 'row' },
      h(
        'div',
        { class: 'grow' },
        h('div', { class: 'name' }, it.title),
        h('div', { class: 'muted small' }, [it.authors, it.year, it.publication].filter(Boolean).join(' · ')),
        status,
      ),
      button,
    );
  };

  (async () => {
    const creds = (await readSettings(app.storage)).zotero;
    if (!creds) {
      fill(body, h('p', null, 'Zotero is not connected yet.'), h('p', { class: 'muted' }, 'Go to the Account tab → Zotero, and paste a read-only API key from zotero.org/settings/keys.'), h('a', { href: '#/account' }, 'Open Account'));
      return;
    }
    client = new ZoteroClient(creds);
    try {
      collections = await client.collections();
    } catch (err) {
      fill(body, h('p', { class: 'error' }, (err as Error).message));
      return;
    }
    const select = h('select', { 'aria-label': 'Collection' }, h('option', { value: '' }, 'All items'), collections.map((c) => h('option', { value: c.key }, c.parent ? `  ${c.name}` : c.name))) as HTMLSelectElement;
    select.addEventListener('change', () => {
      collection = select.value;
      void load();
    });
    const search = h('input', { type: 'text', placeholder: 'Search title, author, year…', 'aria-label': 'Search Zotero' }) as HTMLInputElement;
    let t: ReturnType<typeof setTimeout>;
    search.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => {
        q = search.value;
        void load();
      }, 400);
    });
    fill(body, h('p', { class: 'muted small' }, `Library of ${creds.username ?? 'your account'}. Items with a stored PDF can be imported; the PDF is cleaned like any other.`), select, search, list);
    await load();
  })();

  return screen;
}
