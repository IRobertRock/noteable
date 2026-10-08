// Runs an import with a progress panel over the screen. OCR can take minutes,
// so the screen is kept on while it runs.

import { editHash, type App } from '../app';
import { importDocuments, type ImportOptions, type SourceRef } from '../import/importDocument';
import { holdWakeLock, releaseWakeLock } from '../sleep/wakeLock';
import { h } from './h';

export async function runImport(app: App, sources: SourceRef[], opts: Omit<ImportOptions, 'onProgress' | 'defaultVoice'> = {}): Promise<void> {
  const message = h('p', null, 'Starting…');
  const bar = h('progress', { max: 1 }) as HTMLProgressElement;
  bar.removeAttribute('value'); // indeterminate until a reader reports pages
  const panel = h(
    'div',
    { class: 'import-overlay', role: 'dialog', 'aria-live': 'polite' },
    h('div', { class: 'import-card' }, h('h2', null, sources.length > 1 ? `Importing ${sources.length} files` : 'Importing'), message, bar, h('p', { class: 'muted small' }, 'Scanned PDFs are read with OCR on this device, which can take a minute per page. Keep Noteable open.')),
  );
  document.body.append(panel);
  await holdWakeLock();
  try {
    await app.reconnectNow();
    const result = await importDocuments(app.storage, sources, {
      ...opts,
      defaultVoice: await app.defaultVoice(),
      onProgress: (msg, fraction) => {
        message.textContent = msg;
        if (fraction === undefined) bar.removeAttribute('value');
        else bar.value = fraction;
      },
    });
    void app.library.refresh().catch(() => {});
    app.go(editHash(result.itemPath));
  } catch (err) {
    message.textContent = `Import failed: ${(err as Error).message}`;
    message.className = 'error';
    bar.remove();
    panel.querySelector('.import-card')!.append(h('button', { onclick: () => panel.remove() }, 'Close'));
    return;
  } finally {
    await releaseWakeLock();
  }
  panel.remove();
}
