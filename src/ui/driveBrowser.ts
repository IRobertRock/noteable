// Pick a file from anywhere in My Drive (PDFs, Word, PowerPoint, EPUB,
// Google Docs and Slides). The file is copied into the new item's sources/.

import type { App } from '../app';
import { FORMAT_LABEL, formatOf } from '../import/importDocument';
import type { ExternalEntry } from '../storage/Storage';
import { formatBytes, formatDate } from './format';
import { fill, h } from './h';
import { runImport } from './importRun';

/** Breadcrumbs survive moving between folders within one visit. */
let trail: { id: string; name: string }[] = [];

export function driveBrowserScreen(app: App, folderId?: string): HTMLElement {
  const body = h('div', null, h('p', { class: 'muted' }, 'Loading…'));
  const crumbs = h('nav', { class: 'crumbs', 'aria-label': 'Folder path' });
  const screen = h('section', { class: 'screen' }, h('h1', null, 'Pick from Drive'), crumbs, body);

  if (!folderId) trail = [];
  else {
    const at = trail.findIndex((t) => t.id === folderId);
    if (at >= 0) trail = trail.slice(0, at + 1);
  }

  fill(
    crumbs,
    h('a', { href: '#/drive' }, 'My Drive'),
    trail.flatMap((t) => [' › ', h('a', { href: `#/drive/${encodeURIComponent(t.id)}` }, t.name)]),
  );

  (async () => {
    if (!app.storage.browse) return fill(body, h('p', { class: 'error' }, 'Browsing Drive is not available with this storage.'));
    try {
      const entries = await app.storage.browse(folderId);
      const usable = entries.filter((e) => e.kind === 'folder' || formatOf(e.name, e.mimeType));
      const hidden = entries.length - usable.length;
      fill(
        body,
        usable.length ? h('div', { class: 'list' }, usable.map((e) => row(e))) : h('p', { class: 'muted' }, 'No folders or importable files here.'),
        hidden > 0 && h('p', { class: 'muted small' }, `${hidden} other file${hidden > 1 ? 's' : ''} (images, spreadsheets…) not shown.`),
      );
    } catch (err) {
      fill(body, h('p', { class: 'error' }, (err as Error).message));
    }
  })();

  const row = (e: ExternalEntry) => {
    if (e.kind === 'folder') {
      return h(
        'button',
        {
          class: 'row link',
          onclick: () => {
            trail.push({ id: e.id, name: e.name });
            app.go(`#/drive/${encodeURIComponent(e.id)}`);
          },
        },
        h('span', { 'aria-hidden': true }, '📁'),
        h('div', { class: 'grow name' }, e.name),
        h('span', { class: 'muted' }, '›'),
      );
    }
    const format = formatOf(e.name, e.mimeType)!;
    return h(
      'div',
      { class: 'row' },
      h(
        'div',
        { class: 'grow' },
        h('div', { class: 'name' }, e.name),
        h('div', { class: 'muted small' }, [FORMAT_LABEL[format], e.size ? formatBytes(e.size) : '', formatDate(e.modifiedTime)].filter(Boolean).join(' · ')),
      ),
      h('button', { class: 'primary small', onclick: () => void runImport(app, [{ kind: 'drive', id: e.id, name: e.name, mimeType: e.mimeType }]) }, 'Import'),
    );
  };

  return screen;
}
