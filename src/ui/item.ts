import { currentJob, onJobChange, retryUploads, startJob, stopJob, waitingChapters, type JobState } from '../generate/jobs';
import { ITEM_FILE, itemDuration, type Item } from '../model/item';
import { VOICES } from '../model/voices';
import { readJson, type Storage } from '../storage/Storage';
import { formatBytes, formatDuration } from './format';
import { fill, h } from './h';

export interface ItemCtx {
  storage: Storage;
  itemPath: string;
  onLeave: (fn: () => void) => void;
  reconnect: () => Promise<void>;
}

export function itemScreen(ctx: ItemCtx): HTMLElement {
  const screen = h('section', { class: 'screen' }, h('p', { class: 'muted' }, 'Loading…'));
  let item: Item | null = null;
  let waiting = 0;
  let voice = '';

  const refresh = async () => {
    try {
      item = await readJson<Item>(ctx.storage, `${ctx.itemPath}/${ITEM_FILE}`);
      waiting = await waitingChapters(ctx.itemPath);
      voice ||= item.voice;
      render();
    } catch (err) {
      screen.replaceChildren(h('p', { class: 'error' }, (err as Error).message));
    }
  };

  const render = () => {
    if (!item) return;
    const job = currentJob();
    const mine = job?.itemPath === ctx.itemPath ? job : null;
    const busyElsewhere = !!job?.running && !mine;
    const done = item.chapters.filter((c) => c.status === 'done').length;
    const started = done > 0 || waiting > 0;

    const select = h(
      'select',
      { disabled: !!mine?.running, onchange: (e: Event) => (voice = (e.target as HTMLSelectElement).value) },
      VOICES.map((v) => h('option', { value: v.id, selected: v.id === voice }, `${v.name} — ${v.label}`)),
    );

    const generateLabel = done === item.chapters.length ? 'Generate again' : started && voice === item.voice ? 'Resume' : 'Generate';
    const totalChars = item.chapters.reduce((n, c) => n + c.chars, 0);

    fill(
      screen,
      h('p', { class: 'muted small' }, item.collection),
      h('h1', null, item.title),
      h('p', { class: 'muted' }, `${item.mode === 'teach' ? 'Teach' : 'Narrate'} · ${item.chapters.length} chapters · about ${estimateMinutes(totalChars)} min of audio`),
      item.error && !mine?.running && h('p', { class: 'error' }, `Last run stopped: ${item.error}`),

      h('h2', null, 'Generate'),
      h('label', { class: 'field' }, h('span', null, 'Voice'), select),
      voice !== item.voice && started && h('p', { class: 'muted small' }, 'Changing the voice regenerates every chapter.'),
      mine?.running
        ? h('button', { onclick: stopJob }, 'Stop')
        : h(
            'div',
            { class: 'buttons' },
            h(
              'button',
              {
                class: 'primary',
                disabled: busyElsewhere,
                onclick: () => {
                  void startJob(ctx.storage, ctx.itemPath, voice).then(refresh);
                },
              },
              `${generateLabel} on this device`,
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
                  await ctx.reconnect();
                  await retryUploads(ctx.storage, ctx.itemPath);
                } finally {
                  await refresh();
                }
              },
            },
            'Finish uploading',
          ),
        ),
      mine?.running &&
        h('p', { class: 'muted small' }, 'Keep Noteable open and the screen on until it finishes. Switching apps pauses generation. (Sleep mode arrives in phase 4.)'),

      h('h2', null, 'Chapters'),
      h(
        'ol',
        { class: 'status chapters' },
        item.chapters.map((c) =>
          h(
            'li',
            null,
            h('span', null, c.title),
            h(
              'span',
              { class: `pill ${c.status === 'done' ? 'found' : mine?.progress?.chapter === c.n && mine.running ? 'created' : ''}` },
              c.status === 'done' ? formatDuration(c.durationSec ?? 0) : mine?.progress?.chapter === c.n && mine.running ? `${Math.round((mine.progress.chapterFraction ?? 0) * 100)}%` : 'Pending',
            ),
          ),
        ),
      ),
      item.status === 'ready' && h('p', { class: 'muted small' }, `Total ${formatDuration(itemDuration(item))}. Audio is in Drive: Noteable/${ctx.itemPath}/audio/. The player arrives in phase 3.`),
      item.lastGenerated &&
        h('p', { class: 'muted small' }, `Last generated on ${item.lastGenerated.device} (${item.lastGenerated.engine}) at ${item.lastGenerated.realTimeFactor}× real time.`),
    );
  };

  const off = onJobChange((job: JobState | null) => {
    if (job?.itemPath !== ctx.itemPath) return render();
    if (!job.running || job.progress?.phase === 'uploading') void refresh();
    else render();
  });
  ctx.onLeave(off);

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
