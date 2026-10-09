import type { App } from '../app';
import { VOICES } from '../model/voices';
import { readSettings, updateSettings } from '../settings';
import { ZoteroClient } from '../zotero/client';
import { logTail } from '../log';
import { pronunciationsSection } from './pronunciations';
import { deviceName } from '../generate/jobs';
import { LOG_REQUEST_PATH } from '../queue/logRequest';
import { formatBytes } from './format';
import { fill, h } from './h';

/** Default voice (synced in State/settings.json) and storage used on this device. */
export function settingsSection(app: App): HTMLElement {
  const voiceStatus = h('span', { class: 'muted small' });
  const storageLine = h('p', { class: 'muted small' }, 'Checking storage…');
  const select = h('select', { 'aria-label': 'Default voice' }, VOICES.map((v) => h('option', { value: v.id }, `${v.name} — ${v.label}`))) as HTMLSelectElement;

  void app.defaultVoice().then((v) => (select.value = v));
  select.addEventListener('change', async () => {
    voiceStatus.textContent = 'Saving…';
    try {
      await updateSettings(app.storage, { voice: select.value });
      voiceStatus.textContent = 'Saved';
    } catch (err) {
      voiceStatus.textContent = `Not saved: ${(err as Error).message}`;
    }
  });

  void (async () => {
    const est = await navigator.storage?.estimate?.().catch(() => undefined);
    const downloads = Object.values(app.downloads.records);
    const bytes = downloads.reduce((n, r) => n + r.bytes, 0);
    const persisted = await navigator.storage?.persisted?.().catch(() => false);
    fill(
      storageLine,
      `Downloaded items: ${downloads.length} (${formatBytes(bytes)}). `,
      est?.usage !== undefined ? `Noteable uses ${formatBytes(est.usage)} on this device, including the voice model. ` : '',
      persisted ? 'Storage is protected from automatic clean-up.' : '',
    );
  })();

  // Zotero: paste a read-only key; the account is looked up from it.
  const zotero = h('div', { class: 'field' });
  const renderZotero = async () => {
    const creds = (await readSettings(app.storage)).zotero;
    if (creds) {
      fill(
        zotero,
        h('span', null, 'Zotero'),
        h('p', { class: 'small' }, `Connected to ${creds.username ?? `user ${creds.userId}`}'s library. `, h('a', { href: '#/zotero' }, 'Import from Zotero')),
        h('button', { class: 'small', onclick: async () => (await updateSettings(app.storage, { zotero: undefined }), void renderZotero()) }, 'Disconnect'),
      );
      return;
    }
    const key = h('input', { type: 'password', placeholder: 'Zotero API key', autocomplete: 'off', 'aria-label': 'Zotero API key' }) as HTMLInputElement;
    const status = h('span', { class: 'muted small' }, 'Create a key at zotero.org/settings/keys with "Allow library access" (read-only is enough).');
    const connect = h('button', { class: 'small' }, 'Connect') as HTMLButtonElement;
    connect.addEventListener('click', async () => {
      connect.disabled = true;
      status.textContent = 'Checking…';
      try {
        const creds2 = await ZoteroClient.connect(key.value);
        await updateSettings(app.storage, { zotero: creds2 });
        void renderZotero();
      } catch (err) {
        status.textContent = (err as Error).message;
        connect.disabled = false;
      }
    });
    fill(zotero, h('span', null, 'Zotero'), key, connect, status);
  };
  void renderZotero();

  // Storage: downloaded items by size, with Remove.
  const downloadsList = h('div');
  const renderDownloads = () => {
    const rows = Object.values(app.downloads.records)
      .map((r) => ({ r, x: app.library.byId(r.itemId) }))
      .sort((a, b) => b.r.bytes - a.r.bytes);
    fill(
      downloadsList,
      rows.length
        ? h(
            'ul',
            { class: 'status' },
            rows.map(({ r, x }) =>
              h(
                'li',
                null,
                h('span', { class: 'grow' }, x?.item.title ?? 'Item no longer in the library'),
                h('span', { class: 'muted small' }, formatBytes(r.bytes)),
                h(
                  'button',
                  {
                    class: 'small',
                    onclick: async () => {
                      if (x) await app.downloads.remove(x.item);
                      else {
                        const { [r.itemId]: _gone, ...rest } = app.downloads.records;
                        app.downloads.records = rest;
                      }
                      renderDownloads();
                    },
                  },
                  'Remove',
                ),
              ),
            ),
          )
        : h('p', { class: 'muted small' }, 'Nothing downloaded on this device.'),
    );
  };
  renderDownloads();

  // Report a problem: write this device's recent log (and ask the desktop for its own) to Noteable/Logs.
  const reportStatus = h('span', { class: 'muted small' });
  const report = h('button', { class: 'small' }, 'Report a problem') as HTMLButtonElement;
  report.addEventListener('click', async () => {
    report.disabled = true;
    reportStatus.textContent = 'Writing…';
    try {
      await app.reconnectNow();
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const path = `Logs/${stamp}-${deviceName().replace(/\W+/g, '-').toLowerCase()}.md`;
      const lines = await logTail();
      const job = app.player.entry ? `\n## Now playing\n\n${app.player.entry.path}, chapter ${app.player.chapter}\n` : '';
      await app.storage.write(
        path,
        `# Noteable problem report\n\n- Device: ${deviceName()}\n- App version: ${__APP_VERSION__}\n- Browser: ${navigator.userAgent}\n- Online: ${navigator.onLine}\n- Written: ${new Date().toISOString()}\n${job}\n## Recent log (${lines.length} lines)\n\n\`\`\`\n${lines.join('\n') || '(empty)'}\n\`\`\`\n`,
        'text/markdown',
      );
      await app.storage.write(LOG_REQUEST_PATH, JSON.stringify({ requestedAt: new Date().toISOString() }), 'application/json');
      reportStatus.textContent = `Saved to Noteable/${path}. The desktop adds its own log within a minute if it's running. Ask Claude in chat to read Noteable/Logs.`;
    } catch (err) {
      reportStatus.textContent = `Could not write the report: ${(err as Error).message}`;
    } finally {
      report.disabled = false;
    }
  });

  return h(
    'div',
    { class: 'settings' },
    h('h2', null, 'Settings'),
    h('label', { class: 'field' }, h('span', null, 'Default voice for new items'), select, voiceStatus),
    pronunciationsSection(app),
    zotero,
    h('h2', null, 'This device'),
    storageLine,
    h('h2', null, 'Downloads'),
    downloadsList,
    h('h2', null, 'Help'),
    h('div', { class: 'field' }, report, reportStatus),
  );
}
