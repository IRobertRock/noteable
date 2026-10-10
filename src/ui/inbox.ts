// Inbox: files waiting to be imported. Import one, combine several into a
// course pack, upload from this device, or pick something elsewhere in Drive.

import type { App } from '../app';
import { itemHash } from '../app';
import { ACCEPT, FORMAT_LABEL, formatOf, type SourceRef } from '../import/importDocument';
import { importMarkdown } from '../import/importMarkdown';
import type { Entry } from '../storage/Storage';
import { formatBytes, formatDate } from './format';
import { fill, h } from './h';
import { runImport } from './importRun';
import { isRecording } from '../import/transcript';
import { sendRecording } from '../queue/jobs';

export function inboxScreen(app: App): HTMLElement {
  const message = h('div');
  const list = h('div', null, h('p', { class: 'muted' }, 'Loading…'));
  const pack = h('div');
  let entries: Entry[] = [];
  let selected: Entry[] = [];
  let packTitle = '';

  const upload = h('input', { type: 'file', accept: `${ACCEPT},audio/*`, multiple: true, hidden: true }) as HTMLInputElement;
  upload.addEventListener('change', async () => {
    const files = Array.from(upload.files ?? []);
    upload.value = '';
    // Recordings go to the Inbox in Drive, where Transcribe on desktop picks them up.
    const recordings = files.filter((f) => isRecording(f.name, f.type));
    const docs = files.filter((f) => !recordings.includes(f));
    for (const f of recordings) {
      message.replaceChildren(h('p', { class: 'muted' }, `Uploading ${f.name}…`));
      try {
        await app.reconnectNow();
        await app.storage.write(`Inbox/${f.name}`, f, f.type || undefined);
        message.replaceChildren(h('p', { class: 'muted' }, `${f.name} is in the Inbox. Tap 🎙 Transcribe on desktop.`));
      } catch (err) {
        message.replaceChildren(h('p', { class: 'error', role: 'alert' }, `Upload failed: ${(err as Error).message}`));
      }
    }
    if (recordings.length) void load();
    if (docs.length) void runImport(app, docs.map((file) => ({ kind: 'upload', file })));
  });

  const screen = h(
    'section',
    { class: 'screen' },
    h('h1', null, 'Inbox'),
    h(
      'div',
      { class: 'buttons' },
      h('button', { onclick: () => upload.click() }, '⬆ Upload from this device'),
      app.storage.browse && h('button', { onclick: () => app.go('#/drive') }, '📁 Pick from Google Drive'),
      h('button', { onclick: () => app.go('#/zotero') }, '📚 From Zotero'),
    ),
    upload,
    message,
    list,
    pack,
  );

  const load = async () => {
    try {
      entries = (await app.storage.list('Inbox')).filter((e) => e.kind === 'file');
      entries.sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime));
      selected = selected.filter((s) => entries.some((e) => e.id === s.id));
      render();
    } catch (err) {
      fill(list, h('p', { class: 'error' }, (err as Error).message));
    }
  };

  const toSource = (e: Entry): SourceRef => ({ kind: 'storage', path: e.path, id: e.id, name: e.name, mimeType: e.mimeType });

  const importOne = async (e: Entry, button: HTMLButtonElement) => {
    const format = formatOf(e.name, e.mimeType);
    // Claude-written guides (.md) keep their own chapters and go straight to the item.
    if (format === 'markdown') {
      button.disabled = true;
      button.textContent = 'Importing…';
      try {
        const r = await importMarkdown(app.storage, e.path, await app.defaultVoice());
        void app.library.refresh().catch(() => {});
        if (r.warnings.length) message.replaceChildren(h('div', { class: 'banner' }, r.warnings.join(' ')));
        app.go(itemHash(r.itemPath));
      } catch (err) {
        message.replaceChildren(h('p', { class: 'error', role: 'alert' }, (err as Error).message));
        button.disabled = false;
        button.textContent = 'Import';
      }
      return;
    }
    await runImport(app, [toSource(e)]);
  };

  const render = () => {
    fill(
      list,
      entries.length
        ? h(
            'div',
            { class: 'list' },
            entries.map((e) => {
              const format = formatOf(e.name, e.mimeType);
              const check = h('input', { type: 'checkbox', 'aria-label': `Add ${e.name} to a course pack`, checked: selected.some((s) => s.id === e.id), disabled: !format }) as HTMLInputElement;
              check.addEventListener('change', () => {
                selected = check.checked ? [...selected, e] : selected.filter((s) => s.id !== e.id);
                render();
              });
              const recording = !format && isRecording(e.name, e.mimeType);
              const button = h('button', { class: format || recording ? 'primary small' : 'small', disabled: !format && !recording }, format ? 'Import' : recording ? '🎙 Transcribe on desktop' : 'Not supported') as HTMLButtonElement;
              button.addEventListener('click', () => {
                if (!recording) return void importOne(e, button);
                button.disabled = true;
                void app
                  .reconnectNow()
                  .then(() => sendRecording(app.storage, e.path))
                  .then(() => app.go('#/queue'))
                  .catch((err: Error) => {
                    message.replaceChildren(h('p', { class: 'error', role: 'alert' }, err.message));
                    button.disabled = false;
                  });
              });
              return h(
                'div',
                { class: 'row' },
                h('label', { class: 'check' }, check),
                h(
                  'div',
                  { class: 'grow' },
                  h('div', { class: 'name' }, e.name),
                  h('div', { class: 'muted small' }, [format ? FORMAT_LABEL[format] : recording ? 'Recording' : 'Unknown type', e.size ? formatBytes(e.size) : '', formatDate(e.modifiedTime)].filter(Boolean).join(' · ')),
                ),
                button,
              );
            }),
          )
        : h('p', { class: 'muted' }, 'Nothing here. Save files to Noteable/Inbox in Google Drive (or ask Claude to), upload one from this device, or pick one from Drive.'),
      entries.length > 1 && h('p', { class: 'muted small' }, 'Tick two or more files to combine them into one course pack.'),
    );

    if (selected.length < 2) {
      fill(pack);
      return;
    }
    const titleInput = h('input', { type: 'text', value: packTitle, placeholder: 'Pack title, e.g. ECON 1000 Week 3', 'aria-label': 'Course pack title' }) as HTMLInputElement;
    titleInput.addEventListener('input', () => (packTitle = titleInput.value));
    const move = (i: number, d: number) => {
      const j = i + d;
      if (j < 0 || j >= selected.length) return;
      [selected[i], selected[j]] = [selected[j], selected[i]];
      render();
    };
    fill(
      pack,
      h(
        'div',
        { class: 'pack' },
        h('h2', null, `Course pack: ${selected.length} files`),
        h('p', { class: 'muted small' }, 'Each file becomes one or more chapters, in this order.'),
        h(
          'ol',
          { class: 'status' },
          selected.map((e, i) =>
            h(
              'li',
              null,
              h('span', { class: 'grow' }, e.name),
              h('button', { class: 'small', 'aria-label': 'Move up', disabled: i === 0, onclick: () => move(i, -1) }, '↑'),
              h('button', { class: 'small', 'aria-label': 'Move down', disabled: i === selected.length - 1, onclick: () => move(i, 1) }, '↓'),
            ),
          ),
        ),
        titleInput,
        h('button', { class: 'primary', onclick: () => void runImport(app, selected.map(toSource), { title: packTitle || undefined }) }, 'Import as one item'),
      ),
    );
  };

  void load();
  return screen;
}
