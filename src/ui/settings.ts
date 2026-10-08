import type { App } from '../app';
import { VOICES } from '../model/voices';
import { readJson, writeJson } from '../storage/Storage';
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
      const current = await readJson<Record<string, unknown>>(app.storage, 'State/settings.json').catch(() => ({ version: 1 }));
      await writeJson(app.storage, 'State/settings.json', { ...current, voice: select.value });
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

  return h(
    'div',
    { class: 'settings' },
    h('h2', null, 'Settings'),
    h('label', { class: 'field' }, h('span', null, 'Default voice for new items'), select, voiceStatus),
    h('h2', null, 'This device'),
    storageLine,
  );
}
