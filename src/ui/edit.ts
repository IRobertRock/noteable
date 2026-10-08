// Text preview: check and fix the cleaned text before generating.
// Rename, edit, exclude and (before any audio) reorder chapters, and see what
// cleanup removed from each.

import { itemHash, type App } from '../app';
import { rereadSources, saveEdits, type ChapterEdit, type RemovedMap } from '../import/editItem';
import { formatOf } from '../import/importDocument';
import type { Removed } from '../import/types';
import { ITEM_FILE, REMOVED_FILE, type Item } from '../model/item';
import { readJson, readText } from '../storage/Storage';
import { fill, h } from './h';

interface Row extends ChapterEdit {
  status: string;
  open: boolean;
  showRemoved: boolean;
}

const REASON_LABEL: Record<Removed['reason'], string> = {
  'page number': 'Page numbers',
  'header or footer': 'Headers and footers',
  citation: 'Citations',
  references: 'Reference list',
  'slide number': 'Slide numbers',
  empty: 'Empty',
};

export function editScreen(app: App, itemPath: string): HTMLElement {
  const screen = h('section', { class: 'screen edit' }, h('p', { class: 'muted' }, 'Loading the text…'));
  let item: Item;
  let rows: Row[] = [];
  let removed: RemovedMap = {};
  let original = new Map<number, string>();
  let title = '';
  let dirty = false;
  let busy = '';
  let error = '';

  const load = async () => {
    try {
      item = await readJson<Item>(app.storage, `${itemPath}/${ITEM_FILE}`);
      removed = await readJson<RemovedMap>(app.storage, `${itemPath}/${REMOVED_FILE}`).catch(() => ({}));
      original = new Map();
      for (const c of item.chapters) original.set(c.n, await readText(app.storage, `${itemPath}/${c.textFile}`));
      title = item.title;
      rows = item.chapters.map((c) => ({ n: c.n, title: c.title, markdown: original.get(c.n)!, excluded: !!c.excluded, status: c.status, open: false, showRemoved: false }));
      dirty = false;
      render();
    } catch (err) {
      fill(screen, h('p', { class: 'error' }, (err as Error).message));
    }
  };

  const mark = () => {
    dirty = true;
    saveBar.hidden = false;
  };

  const saveBar = h('div', { class: 'save-bar', hidden: true });

  const save = async (thenGo?: string) => {
    busy = 'Saving…';
    error = '';
    render();
    try {
      await app.reconnectNow();
      item = await saveEdits(app.storage, itemPath, item, title, rows, original);
      await app.library.put({ path: itemPath, item: { ...item, collection: itemPath.split('/')[1] ?? item.collection } });
      busy = '';
      if (thenGo) return app.go(thenGo);
      await load();
    } catch (err) {
      busy = '';
      error = (err as Error).message;
      render();
    }
  };

  const reread = async () => {
    if (!confirm('Read the source again with OCR? This replaces the text and any edits you made here.')) return;
    busy = 'Reading the source with OCR… this can take a minute per page.';
    render();
    try {
      await app.reconnectNow();
      item = await rereadSources(app.storage, itemPath, item, { forceOcr: true, onProgress: (m) => ((busy = m), render()) });
      busy = '';
      await load();
    } catch (err) {
      busy = '';
      error = (err as Error).message;
      render();
    }
  };

  const render = () => {
    const hasAudio = rows.some((r) => r.status === 'done');
    const hasPdf = item.sources.some((s) => formatOf(s) === 'pdf');
    const totalRemoved = Object.values(removed).flat().length;
    const titleInput = h('input', { type: 'text', class: 'title-input', value: title, 'aria-label': 'Item title' }) as HTMLInputElement;
    titleInput.addEventListener('input', () => {
      title = titleInput.value;
      mark();
    });

    fill(
      saveBar,
      h('button', { class: 'primary', disabled: !!busy, onclick: () => void save(itemHash(itemPath)) }, 'Save and continue'),
      h('button', { disabled: !!busy, onclick: () => void save() }, 'Save'),
    );
    saveBar.hidden = !dirty;

    fill(
      screen,
      h('p', { class: 'muted small' }, `${item.collection} › Check the text`),
      titleInput,
      h(
        'p',
        { class: 'muted small' },
        `${rows.filter((r) => !r.excluded).length} of ${rows.length} chapters included.`,
        totalRemoved ? ` Cleanup removed ${totalRemoved} bits of text (page numbers, citations, etc.); open a chapter's "Removed" list to check them.` : '',
      ),
      item.ocr && h('p', { class: 'banner' }, 'Some of this text was read from scanned pages with OCR. Skim it for misread words before generating.'),
      busy && h('p', { class: 'banner' }, busy),
      error && h('p', { class: 'error', role: 'alert' }, error),
      h(
        'ol',
        { class: 'edit-list' },
        rows.map((r, i) => chapterRow(r, i, hasAudio)),
      ),
      h(
        'div',
        { class: 'buttons' },
        h('button', { class: 'primary', disabled: !!busy, onclick: () => (dirty ? void save(itemHash(itemPath)) : app.go(itemHash(itemPath))) }, dirty ? 'Save and continue' : 'Looks good, continue'),
        hasPdf && !hasAudio && h('button', { disabled: !!busy, onclick: () => void reread() }, 'Re-run with OCR'),
      ),
      saveBar,
    );
  };

  const chapterRow = (r: Row, i: number, hasAudio: boolean) => {
    const rm = removed[r.n] ?? [];
    const include = h('input', { type: 'checkbox', checked: !r.excluded, 'aria-label': 'Include this chapter' }) as HTMLInputElement;
    include.addEventListener('change', () => {
      r.excluded = !include.checked;
      mark();
      render();
    });
    const name = h('input', { type: 'text', value: r.title, 'aria-label': 'Chapter title' }) as HTMLInputElement;
    name.addEventListener('input', () => {
      r.title = name.value;
      mark();
    });
    const move = (d: number) => {
      const j = i + d;
      if (j < 0 || j >= rows.length) return;
      [rows[i], rows[j]] = [rows[j], rows[i]];
      mark();
      render();
    };
    const words = r.markdown.split(/\s+/).length;

    let editor: HTMLElement | false = false;
    if (r.open) {
      const ta = h('textarea', { rows: 14, spellcheck: true, 'aria-label': `Text of ${r.title}` }) as HTMLTextAreaElement;
      ta.value = r.markdown;
      ta.addEventListener('input', () => {
        r.markdown = ta.value;
        mark();
      });
      editor = ta;
    }

    return h(
      'li',
      { class: `edit-row${r.excluded ? ' excluded' : ''}` },
      h(
        'div',
        { class: 'edit-head' },
        h('label', { class: 'check' }, include),
        name,
        !hasAudio && h('button', { class: 'small', 'aria-label': 'Move up', disabled: i === 0, onclick: () => move(-1) }, '↑'),
        !hasAudio && h('button', { class: 'small', 'aria-label': 'Move down', disabled: i === rows.length - 1, onclick: () => move(1) }, '↓'),
      ),
      h(
        'div',
        { class: 'edit-tools' },
        h('span', { class: 'muted small' }, `${words.toLocaleString()} words${r.status === 'done' ? ' · has audio (editing regenerates it)' : ''}`),
        h('button', { class: 'link-button small', onclick: () => ((r.open = !r.open), render()) }, r.open ? 'Hide text' : 'Read / edit text'),
        rm.length > 0 && h('button', { class: 'link-button small', onclick: () => ((r.showRemoved = !r.showRemoved), render()) }, r.showRemoved ? 'Hide removed' : `Removed (${rm.length})`),
      ),
      r.showRemoved && removedList(rm),
      editor,
    );
  };

  void load();
  return screen;
}

function removedList(rm: Removed[]): HTMLElement {
  const groups = new Map<string, Removed[]>();
  for (const r of rm) groups.set(r.reason, [...(groups.get(r.reason) ?? []), r]);
  return h(
    'div',
    { class: 'removed' },
    [...groups].map(([reason, items]) =>
      h(
        'details',
        { open: items.length <= 6 },
        h('summary', null, `${REASON_LABEL[reason as Removed['reason']] ?? reason} (${items.length})`),
        h('ul', null, items.slice(0, 200).map((x) => h('li', null, x.page ? h('span', { class: 'muted' }, `p. ${x.page} `) : '', x.text.length > 160 ? `${x.text.slice(0, 160)}…` : x.text))),
      ),
    ),
  );
}
