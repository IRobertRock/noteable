import { IMPORTABLE, importMarkdown } from '../import/importMarkdown';
import type { Entry, Storage } from '../storage/Storage';
import { formatBytes, formatDate } from './format';
import { h } from './h';

export interface InboxCtx {
  storage: Storage;
  defaultVoice: () => Promise<string>;
  openItem: (itemPath: string) => void;
}

export function inboxScreen(ctx: InboxCtx): HTMLElement {
  const list = h('div', { class: 'list' }, h('p', { class: 'muted' }, 'Loading…'));
  const message = h('div');
  const screen = h('section', { class: 'screen' }, h('h1', null, 'Inbox'), message, list);

  const load = async () => {
    try {
      const entries = (await ctx.storage.list('Inbox')).filter((e) => e.kind === 'file');
      entries.sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime));
      list.replaceChildren(
        ...(entries.length
          ? entries.map(row)
          : [h('p', { class: 'muted' }, 'Nothing here. Save a .md file to Noteable/Inbox in Google Drive (or ask Claude to), then pull to refresh.')]),
      );
    } catch (err) {
      list.replaceChildren(h('p', { class: 'error' }, (err as Error).message));
    }
  };

  const row = (e: Entry) => {
    const canImport = IMPORTABLE.test(e.name);
    const button = h('button', { class: canImport ? 'primary small' : 'small', disabled: !canImport }, canImport ? 'Import' : 'Later');
    button.addEventListener('click', async () => {
      button.disabled = true;
      button.textContent = 'Importing…';
      message.replaceChildren();
      try {
        const result = await importMarkdown(ctx.storage, e.path, await ctx.defaultVoice());
        if (result.warnings.length) {
          message.replaceChildren(h('div', { class: 'banner' }, result.warnings.join(' ')));
          setTimeout(() => ctx.openItem(result.itemPath), 2500);
        } else {
          ctx.openItem(result.itemPath);
        }
      } catch (err) {
        message.replaceChildren(h('p', { class: 'error', role: 'alert' }, (err as Error).message));
        button.disabled = false;
        button.textContent = 'Import';
      }
    });
    return h(
      'div',
      { class: 'row' },
      h(
        'div',
        { class: 'grow' },
        h('div', { class: 'name' }, e.name),
        h('div', { class: 'muted small' }, `${formatBytes(e.size ?? 0)} · ${formatDate(e.modifiedTime)}`, !canImport && ' · PDF, DOCX and other formats arrive in phase 5'),
      ),
      button,
    );
  };

  void load();
  return screen;
}
