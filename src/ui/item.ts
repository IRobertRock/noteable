import { editHash, readHash, type App } from '../app';
import { aboutMinutes, estimate, LONG_JOB_SEC, type Estimate } from '../generate/estimate';
import { currentJob, deviceName, onJobChange, retryUploads, startJob, stopJob, waitingChapters, type JobState } from '../generate/jobs';
import { enterSleepMode } from '../sleep/sleepScreen';
import { activeJobFor, listJobs, sendToDesktop, type JobView } from '../queue/jobs';
import { applyGuide, dismissGuide, newGuide } from '../import/guideInItem';
import type { Entry } from '../storage/Storage';
import { detail as jobDetail } from './queue';
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
  let est: Estimate | null = null;
  let desktopJob: JobView | undefined;
  let guide: Entry | null = null;

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
      if (entry) est = await estimate(entry.item);
      if (navigator.onLine) desktopJob = activeJobFor(await listJobs(app.storage).catch(() => []), itemPath);
      if (navigator.onLine && entry) guide = await newGuide(app.storage, itemPath, entry.item).catch(() => null);
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
          (ready ? formatDuration(itemDuration(item)) : est ? `${aboutMinutes(est.audioSec)} of audio to generate` : '') +
          (pos && ready ? ` · ${Math.round(listenedFraction(entry, pos.chapter, pos.positionSec) * 100)}% listened` : ''),
        pos && !playingThis && h('span', { class: 'small' }, ` (last on ${pos.device})`),
      ),
      item.zotero && h('p', { class: 'muted small' }, `From Zotero: ${[item.zotero.authors, item.zotero.year, item.zotero.publication].filter(Boolean).join(' · ')}`),
      message && h('p', { class: 'error', role: 'alert' }, message),
      guide &&
        !mine?.running &&
        !desktopJob &&
        h(
          'div',
          { class: 'banner action column' },
          h('span', null, h('strong', null, 'A study guide was added to this item (guide.md). '), 'Listen to the guide instead? Its chapters replace the current text', done > 0 ? ' and audio' : '', '; the original files stay in sources/.'),
          h(
            'div',
            { class: 'buttons' },
            h(
              'button',
              {
                class: 'primary small',
                onclick: async () => {
                  try {
                    await app.reconnectNow();
                    const next = await applyGuide(app.storage, itemPath, entry!.item, guide!);
                    voice = next.voice;
                    guide = null;
                  } catch (err) {
                    message = (err as Error).message;
                  }
                  await refresh();
                },
              },
              'Use the study guide',
            ),
            h(
              'button',
              {
                class: 'small',
                onclick: async () => {
                  await dismissGuide(app.storage, itemPath, entry!.item, guide!).catch(() => {});
                  guide = null;
                  await refresh();
                },
              },
              'Keep as is',
            ),
          ),
        ),
      item.ocr && done === 0 && h('p', { class: 'banner' }, 'Some text was read from scanned pages. Check it before generating.'),

      done > 0 &&
        h(
          'div',
          { class: 'buttons' },
          h(
            'button',
            {
              class: 'primary',
              onclick: async () => {
                if (playingThis) return app.go('#/player');
                // Streaming from Drive needs sign-in to last; a downloaded item doesn't.
                if (!downloaded && navigator.onLine) await app.freshFor(30);
                await app.player.open(entry!);
                app.go('#/player');
              },
            },
            `▶ ${playLabel}`,
          ),
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
      !mine?.running && h('button', { class: done === 0 ? undefined : 'link-button small', onclick: () => app.go(editHash(itemPath)) }, done === 0 ? '✎ Check / edit the text' : 'Edit text…'),

      h('h2', null, 'Chapters'),
      h(
        'ol',
        { class: 'status chapters' },
        item.chapters.filter((c) => !c.excluded).map((c) => {
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
    const long = !!est && est.audioSec > LONG_JOB_SEC;
    const estimateLine =
      est && !mine?.running
        ? `${aboutMinutes(est.audioSec)} of audio. ` +
          (est.generateSec ? `Ready in ${aboutMinutes(est.generateSec)} on this ${deviceName()} (measured ${est.realTimeFactor!.toFixed(1)}× real time).` : `This device's speed is measured on its first run.`)
        : null;
    return h(
      'div',
      { class: 'generate' },
      h('h2', null, 'Generate'),
      item.error && !mine?.running && h('p', { class: 'error' }, `Last run stopped: ${item.error}`),
      h('label', { class: 'field' }, h('span', null, 'Voice'), select),
      voice !== item.voice && started && h('p', { class: 'muted small' }, 'Changing the voice regenerates every chapter.'),
      estimateLine && h('p', { class: 'muted small' }, estimateLine),
      long && !mine?.running && !desktopJob && h('p', { class: 'banner' }, 'This is a long job (over 45 minutes of audio). The phone may get warm; Send to desktop is the better choice for jobs this size.'),
      desktopJob &&
        h(
          'div',
          { class: 'progress' },
          h('strong', null, desktopJob.stalled ? 'Desktop: stalled' : desktopJob.status === 'working' ? 'Desktop is generating this' : 'Queued on the desktop'),
          h('div', null, jobDetail(desktopJob)),
          desktopJob.progress && h('progress', { max: desktopJob.progress.chaptersTotal, value: desktopJob.progress.chaptersDone }),
          h('a', { href: '#/queue' }, 'Open the desktop queue'),
        ),
      desktopJob
        ? false
        : mine?.running
        ? h(
            'div',
            { class: 'buttons' },
            h('button', { class: 'primary', onclick: enterSleepMode }, '☾ Sleep mode'),
            h('button', { onclick: stopJob }, 'Stop'),
          )
        : h(
            'div',
            { class: 'buttons' },
            h(
              'button',
              {
                class: done === 0 ? 'primary' : undefined,
                disabled: busyElsewhere || !navigator.onLine,
                onclick: async () => {
                  // Uploads happen as chapters finish; keep sign-in alive for the whole job if we can.
                  await app.freshFor((est?.generateSec ?? 30 * 60) / 60 + 5);
                  void startJob(app.storage, itemPath, voice, item, est?.charsPerSec ?? 15).then(refresh);
                },
              },
              `${label} on this device`,
            ),
            h(
              'button',
              {
                class: long && done === 0 ? 'primary' : undefined,
                disabled: !navigator.onLine,
                onclick: async () => {
                  message = undefined;
                  try {
                    await app.reconnectNow();
                    await sendToDesktop(app.storage, itemPath, item, voice);
                  } catch (err) {
                    message = (err as Error).message;
                  }
                  await refresh();
                },
              },
              '🖥 Send to desktop',
            ),
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
      mine?.running &&
        h(
          'p',
          { class: 'muted small' },
          'The screen stays on while this runs. Tap Sleep mode and put the phone away; it vibrates and chimes when done. Pressing the power button or switching apps pauses the job. Plug in for long jobs.',
          mine.pausedSec >= 5 ? ` Paused so far: ${formatDuration(mine.pausedSec)}.` : '',
        ),
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

  // While the desktop works on this item, check on it every 30 s.
  const poll = setInterval(() => desktopJob && document.visibilityState === 'visible' && void refresh(), 30_000);
  app.onLeave(() => clearInterval(poll));

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
        (job.running && job.remainingAudioSec !== undefined && p.realTimeFactor ? ` · ${aboutMinutes(job.remainingAudioSec / p.realTimeFactor)} left` : '') +
        (p.device ? ` · ${p.device === 'webgpu' ? 'GPU' : 'CPU'}` : ''),
    );
  }
  if (job.error) lines.push(h('span', { class: 'error' }, job.error));
  if (job.result?.uploadError) lines.push(h('span', { class: 'error' }, `Upload paused: ${job.result.uploadError}`));
  return h('div', { class: 'progress' }, lines.map((l) => (typeof l === 'string' ? h('div', null, l) : l)));
}
