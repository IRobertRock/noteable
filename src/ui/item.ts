import { readHash, type App } from '../app';
import { currentJob, onJobChange, retryUploads, startJob, stopJob, waitingChapters, type JobState } from '../generate/jobs';
import type { IndexedItem } from '../library/libraryIndex';
import { ITEM_FILE, itemDuration, type Item } from '../model/item';
import { VOICES } from '../model/voices';
import { listenedFraction } from '../player/player';
import { readJson } from '../storage/Storage';
import { formatBytes, formatDuration } from './format';
import { fill, h } from './h';
import { bookmarkList } from './player';

export function itemScreen(app: App, itemPath: string): HTMLElement {
  const screen = h('section', { class: 'screen' }, h('p', { class: 'muted' }, 'Loading…'));
  let entry: IndexedItem | undefined = app.library.byPath(itemPath);
  let waiting = 0;
  let voice = entry?.item.voice ?? '';
  let showGenerate = false;
  let message: string | undefined;

  const refresh = async () => {
    try {
      waiting = await waitingChapters(itemPath);
      if (navigator.onLine) {
        const item = await readJson<Item>(app.storage, `${itemPath}/${ITEM_FILE}`);
        const collection = itemPath.split('/')[1] ?? item.collection;
        entry = { path: itemPath, item: { ...item, collection } };
        await app.library.put(entry);
      }
      voice ||= entry?.item.voice ?? '';
      render();
    } catch (err) {
      if (entry) render();
      else fill(screen, h('p', { class: 'error' }, (err as Error).message));
    }
  };

  const render = () => {
    if (!entry) return;
    const { item } = entry;
    const job = currentJob();
    const mine = job?.itemPath === itemPath ? job : null;
    const done = item.chapters.filter((c) => c.status === 'done').length;
    const ready = item.status === 'ready';
    const pos = app.state.position(item.id);
    const playingThis = app.player.entry?.item.id === item.id;
    const downloaded = app.downloads.isDownloaded(item) && done > 0;
    const downloading = app.downloads.active.get(item.id);
    const marks = app.state.bookmarksFor(item.id);
    const totalChars = item.chapters.reduce((n, c) => n + c.chars, 0);
    const posChapter = pos && item.chapters.find((c) => c.n === pos.chapter);

    const playLabel = playingThis ? 'Open player' : pos && posChapter ? `Resume · ch ${pos.chapter}, ${formatDuration(pos.positionSec)}` : 'Play';

    fill(
      screen,
      h('p', { class: 'muted small' }, item.collection),
      h('h1', null, item.title),
      h(
        'p',
        { class: 'muted' },
        `${item.mode === 'teach' ? 'Teach' : 'Narrate'} · ${item.chapters.length} chapters · ` +
          (ready ? formatDuration(itemDuration(item)) : `about ${estimateMinutes(totalChars)} min of audio`) +
          (pos && ready ? ` · ${Math.round(listenedFraction(entry, pos.chapter, pos.positionSec) * 100)}% listened` : ''),
        pos && !playingThis && h('span', { class: 'small' }, ` (last on ${pos.device})`),
      ),
      message && h('p', { class: 'error', role: 'alert' }, message),

      done > 0 &&
        h(
          'div',
          { class: 'buttons' },
          h('button', { class: 'primary', onclick: () => (playingThis ? app.go('#/player') : void app.player.open(entry!).then(() => app.go('#/player'))) }, `▶ ${playLabel}`),
          h('button', { onclick: () => app.go(readHash(itemPath)) }, 'Read'),
        ),
      done > 0 &&
        h(
          'div',
          { class: 'buttons' },
          downloading !== undefined
            ? h('button', { disabled: true }, `Downloading… ${Math.round(downloading * 100)}%`)
            : downloaded
              ? h('button', { onclick: () => void app.downloads.remove(item) }, `✓ Downloaded (${formatBytes(app.downloads.records[item.id]?.bytes ?? 0)}) · Remove`)
              : h(
                  'button',
                  {
                    disabled: !navigator.onLine,
                    onclick: async () => {
                      message = undefined;
                      try {
                        await app.reconnectNow();
                        await app.downloads.download(entry!);
                      } catch (err) {
                        message = `Download failed: ${(err as Error).message}`;
                        render();
                      }
                    },
                  },
                  '⬇ Download for offline',
                ),
        ),

      done === 0 || showGenerate || mine || !ready ? generateSection(item, mine, done) : h('button', { class: 'link-button small', onclick: () => ((showGenerate = true), render()) }, 'Regenerate…'),

      h('h2', null, 'Chapters'),
      h(
        'ol',
        { class: 'status chapters' },
        item.chapters.map((c) => {
          const generating = mine?.running && mine.progress?.chapter === c.n;
          const isCurrent = playingThis && app.player.chapter === c.n;
          return h(
            'li',
            { class: isCurrent ? 'current' : undefined },
            c.status === 'done'
              ? h('button', { class: 'link-button', onclick: () => void app.player.open(entry!, c.n, 0) }, c.title)
              : h('span', null, c.title),
            h(
              'span',
              { class: `pill ${c.status === 'done' ? 'found' : generating ? 'created' : ''}` },
              c.status === 'done' ? formatDuration(c.durationSec ?? 0) : generating ? `${Math.round((mine!.progress!.chapterFraction ?? 0) * 100)}%` : 'Not generated',
            ),
          );
        }),
      ),

      marks.length > 0 && [h('h2', null, 'Bookmarks'), bookmarkList(app, marks, item.chapters, null, () => {})],

      item.lastGenerated &&
        h('p', { class: 'muted small' }, `Generated on ${item.lastGenerated.device} (${item.lastGenerated.engine === 'webgpu' ? 'GPU' : 'CPU'}) at ${item.lastGenerated.realTimeFactor}× real time.`),
    );
  };

  const generateSection = (item: Item, mine: JobState | null, done: number) => {
    const busyElsewhere = !!currentJob()?.running && !mine;
    const started = done > 0 || waiting > 0;
    const select = h(
      'select',
      { disabled: !!mine?.running, onchange: (e: Event) => ((voice = (e.target as HTMLSelectElement).value), render()) },
      VOICES.map((v) => h('option', { value: v.id, selected: v.id === voice }, `${v.name} — ${v.label}`)),
    );
    const label = done === item.chapters.length ? 'Generate again' : started && voice === item.voice ? 'Resume generating' : 'Generate';
    return h(
      'div',
      { class: 'generate' },
      h('h2', null, 'Generate'),
      item.error && !mine?.running && h('p', { class: 'error' }, `Last run stopped: ${item.error}`),
      h('label', { class: 'field' }, h('span', null, 'Voice'), select),
      voice !== item.voice && started && h('p', { class: 'muted small' }, 'Changing the voice regenerates every chapter.'),
      mine?.running
        ? h('button', { onclick: stopJob }, 'Stop')
        : h(
            'div',
            { class: 'buttons' },
            h(
              'button',
              { class: done === 0 ? 'primary' : undefined, disabled: busyElsewhere || !navigator.onLine, onclick: () => void startJob(app.storage, itemPath, voice).then(refresh) },
              `${label} on this device`,
            ),
            h('button', { disabled: true, title: 'Arrives in phase 6' }, 'Send to desktop'),
          ),
      busyElsewhere && h('p', { class: 'muted small' }, 'Another item is generating on this device.'),
      mine && progressPanel(mine),
      waiting > 0 &&
        !mine?.running &&
        h(
          'div',
          { class: 'banner action' },
          h('span', null, `${waiting} finished chapter${waiting > 1 ? 's are' : ' is'} saved on this device, waiting to upload.`),
          h(
            'button',
            {
              class: 'primary small',
              onclick: async () => {
                try {
                  await app.reconnectNow();
                  await retryUploads(app.storage, itemPath);
                } finally {
                  await refresh();
                }
              },
            },
            'Finish uploading',
          ),
        ),
      mine?.running && h('p', { class: 'muted small' }, 'Keep Noteable open and the screen on until it finishes. Switching apps pauses generation. (Sleep mode arrives in phase 4.)'),
    );
  };

  app.onLeave(
    onJobChange((job) => {
      if (job?.itemPath !== itemPath) return render();
      if (!job.running || job.progress?.phase === 'uploading') void refresh();
      else render();
    }),
  );
  app.onLeave(app.downloads.onChange(render));
  app.onLeave(app.state.onChange(render));
  // Redraw only when what's playing changes, not on every position tick.
  let playingKey = '';
  app.onLeave(
    app.player.onChange((p) => {
      const key = `${p.entry?.item.id}|${p.chapter}`;
      if (key !== playingKey) {
        playingKey = key;
        render();
      }
    }),
  );

  if (entry) render();
  void refresh();
  return screen;
}

function progressPanel(job: JobState): HTMLElement {
  const p = job.progress;
  const lines: (string | HTMLElement)[] = [];
  if (p?.phase === 'loading-model') {
    const m = p.model;
    lines.push(m && m.totalBytes ? `Downloading the voice model: ${formatBytes(m.loadedBytes)} of ${formatBytes(m.totalBytes)} (first time only)` : 'Loading the voice model…');
    if (m) lines.push(h('progress', { max: 1, value: m.fraction }));
  } else if (p) {
    const overall = (p.chaptersDone + (p.phase === 'generating' ? p.chapterFraction : 0)) / p.chaptersTotal;
    lines.push(h('progress', { max: 1, value: overall }));
    lines.push(
      `${p.phase === 'uploading' ? 'Uploading' : p.phase === 'generating' ? `Chapter ${p.chapter} of ${p.chaptersTotal}` : p.phase === 'done' ? 'Done' : 'Finished; upload waiting'} · ` +
        `${formatDuration(p.audioSec)} of audio in ${formatDuration(p.elapsedSec)}` +
        (p.realTimeFactor ? ` · ${p.realTimeFactor.toFixed(1)}× real time` : '') +
        (p.device ? ` · ${p.device === 'webgpu' ? 'GPU' : 'CPU'}` : ''),
    );
  }
  if (job.error) lines.push(h('span', { class: 'error' }, job.error));
  if (job.result?.uploadError) lines.push(h('span', { class: 'error' }, `Upload paused: ${job.result.uploadError}`));
  return h('div', { class: 'progress' }, lines.map((l) => (typeof l === 'string' ? h('div', null, l) : l)));
}

/** Kokoro speaks roughly 15 characters per second at 1×. Refined in phase 4 with measured numbers. */
function estimateMinutes(chars: number): number {
  return Math.max(1, Math.round(chars / 15 / 60));
}
