// Desktop queue: jobs sent with "Send to desktop" and what the worker is doing.

import { itemHash, type App } from '../app';
import { listJobs, removeJob, retryJob, type JobView } from '../queue/jobs';
import { VOICES } from '../model/voices';
import { fill, h } from './h';
import { describeWorker, isOnline, readWorkerStatus, setWorkerPaused, type WorkerStatus } from '../queue/workerStatus';

const REFRESH_MS = 20_000;

export function queueScreen(app: App): HTMLElement {
  const body = h('div', null, h('p', { class: 'muted' }, 'Loading…'));
  const workerLine = h('p', { class: 'muted small worker-line' });
  const dashboard = h('div', { class: 'dashboard' });
  const screen = h(
    'section',
    { class: 'screen' },
    h('div', { class: 'title-row' }, h('h1', null, 'Desktop queue'), h('button', { class: 'small', onclick: () => void load() }, 'Refresh')),
    h('p', { class: 'muted small' }, 'Items sent with "Send to desktop". The worker on your PC checks every minute while it is running.'),
    workerLine,
    dashboard,
    body,
  );

  const renderDashboard = (w: WorkerStatus | null) => {
    if (!w) return fill(dashboard);
    const facts = [
      w.engine && `Engine: ${w.engine}`,
      w.realTimeFactor && `Last speed: ${w.realTimeFactor}× real time`,
      w.keepingAwake && 'Keeping the PC awake',
    ].filter(Boolean) as string[];
    fill(
      dashboard,
      w.current && h('p', { class: 'small' }, h('strong', null, 'Now: '), w.current),
      facts.length > 0 && h('p', { class: 'muted small' }, facts.join(' · ')),
      w.lastError && h('p', { class: 'error small' }, `Last problem: ${w.lastError}`),
      h(
        'div',
        { class: 'buttons' },
        h(
          'button',
          {
            class: 'small',
            onclick: (e: Event) => {
              (e.currentTarget as HTMLButtonElement).disabled = true;
              void act(() => setWorkerPaused(app.storage, !w.paused)).then(() => {
                workerLine.textContent = w.paused ? 'Resume sent. The desktop picks it up within a minute.' : 'Pause sent. The desktop finishes its current job first.';
              });
            },
          },
          w.paused ? '▶ Resume desktop' : '⏸ Pause desktop',
        ),
      ),
      w.recent &&
        w.recent.length > 0 &&
        h(
          'details',
          null,
          h('summary', { class: 'small' }, `Recent jobs (${w.recent.length})`),
          h(
            'ul',
            { class: 'recent small' },
            w.recent.map((r) =>
              h(
                'li',
                null,
                `${new Date(r.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · ${r.item} · ${r.chapters} ch · `,
                r.result === 'done' ? `${r.realTimeFactor ?? '?'}× in ${r.minutes ?? '?'} min` : h('span', { class: 'error' }, `failed: ${r.error ?? ''}`),
              ),
            ),
          ),
        ),
    );
  };

  const load = async () => {
    try {
      const w = await readWorkerStatus(app.storage);
      workerLine.textContent = describeWorker(w) + (w?.realTimeFactor ? ` · last job ${w.realTimeFactor}× real time` : '');
      workerLine.classList.toggle('online', isOnline(w));
      renderDashboard(w);
      const jobs = await listJobs(app.storage);
      fill(
        body,
        jobs.length ? h('div', { class: 'list' }, jobs.map(row)) : h('p', { class: 'muted' }, 'Nothing queued. On an item, choose "Send to desktop".'),
      );
    } catch (err) {
      fill(body, h('p', { class: 'error' }, (err as Error).message));
    }
  };

  const act = async (fn: () => Promise<void>) => {
    try {
      await app.reconnectNow();
      await fn();
    } catch (err) {
      alert((err as Error).message);
    }
    await load();
  };

  const row = (j: JobView) => {
    const name = j.itemPath.split('/').pop() ?? j.itemPath;
    const voice = VOICES.find((v) => v.id === j.voice)?.name ?? j.voice;
    const [pill, cls] = describe(j);
    return h(
      'div',
      { class: 'row' },
      h(
        'div',
        { class: 'grow' },
        h('a', { class: 'name', href: itemHash(j.itemPath) }, name),
        h('div', { class: 'muted small' }, `${j.chapters.length} chapter${j.chapters.length === 1 ? '' : 's'} · ${voice} · ${detail(j)}`),
        j.error && h('div', { class: 'error small' }, j.error),
      ),
      h('span', { class: `pill ${cls}` }, pill),
      j.status === 'failed' && h('button', { class: 'small', onclick: () => void act(() => retryJob(app.storage, j)) }, 'Retry'),
      j.status !== 'working' && h('button', { class: 'small', 'aria-label': j.status === 'pending' ? 'Cancel' : 'Remove from list', onclick: () => void act(() => removeJob(app.storage, j)) }, j.status === 'pending' ? 'Cancel' : '✕'),
    );
  };

  const timer = setInterval(() => document.visibilityState === 'visible' && void load(), REFRESH_MS);
  app.onLeave(() => clearInterval(timer));
  void load();
  return screen;
}

function describe(j: JobView): [string, string] {
  if (j.stalled) return ['Stalled', 'error'];
  switch (j.status) {
    case 'pending':
      return ['Waiting', 'created'];
    case 'working':
      return ['Working', 'created'];
    case 'done':
      return ['Done', 'found'];
    default:
      return ['Failed', 'error'];
  }
}

export function detail(j: JobView): string {
  if (j.stalled) return 'the desktop stopped responding; it restarts the job when the worker is back';
  if (j.status === 'pending') return `waiting ${ago(j.waitingMs)}${j.waitingMs > 5 * 60_000 ? ' — is the desktop on and the worker running?' : ''}`;
  if (j.status === 'working') {
    const p = j.progress;
    const where = p ? `chapter ${p.chapter ?? p.chaptersDone + 1} of ${p.chaptersTotal}${p.realTimeFactor ? ` at ${p.realTimeFactor}×` : ''}` : 'starting';
    return `${where}, last update ${ago(j.sinceHeartbeatMs ?? 0)} ago`;
  }
  return `${j.status} ${ago(Date.now() - Date.parse(j.updatedAt))} ago`;
}

function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const hrs = Math.round(m / 60);
  return hrs < 48 ? `${hrs} h` : `${Math.round(hrs / 24)} days`;
}
