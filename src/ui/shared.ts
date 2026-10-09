// Shared to Noteable: import shared files, or save a shared link or text to the Inbox.

import type { App } from '../app';
import { claudeLinkPrompt, clearShared, readShared, sharedFiles, sharedLink, sharedNote, type SharedMeta } from '../share/shared';
import { fill, h } from './h';
import { runImport } from './importRun';

export function sharedScreen(app: App): HTMLElement {
  const screen = h('section', { class: 'screen' }, h('p', { class: 'muted' }, 'Loading what you shared…'));
  const status = h('p', { class: 'muted small' });

  const render = (meta: SharedMeta | null) => {
    if (!meta) {
      fill(screen, h('h1', null, 'Shared'), h('p', { class: 'muted' }, 'Nothing waiting. In another app, use Share → Noteable to send a link, text or a document here.'));
      return;
    }
    const link = sharedLink(meta);
    const note = sharedNote(meta);
    const done = async () => {
      await clearShared();
      app.go('#/inbox');
    };
    fill(
      screen,
      h('h1', null, 'Shared to Noteable'),
      meta.title && h('p', null, h('strong', null, meta.title)),
      link && h('p', { class: 'small' }, link),
      meta.text && meta.text !== link && h('p', { class: 'muted small' }, meta.text.slice(0, 400)),
      meta.files.length > 0 && h('p', null, `${meta.files.length} file${meta.files.length > 1 ? 's' : ''}: ${meta.files.map((f) => f.name).join(', ')}`),
      h(
        'div',
        { class: 'buttons' },
        meta.files.length > 0 &&
          h(
            'button',
            {
              class: 'primary',
              onclick: async () => {
                const files = await sharedFiles(meta);
                await clearShared();
                await runImport(app, files.map((file) => ({ kind: 'upload' as const, file })));
              },
            },
            meta.files.length > 1 ? 'Import as one item' : 'Import',
          ),
        (link || meta.text) &&
          h(
            'button',
            {
              class: meta.files.length ? undefined : 'primary',
              onclick: async () => {
                try {
                  await app.reconnectNow();
                  await app.storage.write(`Inbox/${note.name}`, note.markdown, 'text/markdown');
                  status.textContent = note.isLink ? 'Saved to the Inbox as a reminder. Copy the prompt below for Claude.' : 'Saved to the Inbox; import it from there.';
                  if (!note.isLink) await done();
                } catch (err) {
                  status.textContent = (err as Error).message;
                }
              },
            },
            note.isLink ? 'Save link to Inbox' : 'Save text to Inbox',
          ),
        link &&
          h(
            'button',
            {
              onclick: async () => {
                await navigator.clipboard.writeText(claudeLinkPrompt(link)).then(
                  () => (status.textContent = 'Prompt copied. Paste it into Claude; the guide will appear in your Inbox.'),
                  () => (status.textContent = claudeLinkPrompt(link)),
                );
              },
            },
            '🤖 Copy prompt for Claude',
          ),
        h('button', { onclick: () => void done() }, 'Discard'),
      ),
      status,
    );
  };

  void readShared().then(render, () => render(null));
  return screen;
}
