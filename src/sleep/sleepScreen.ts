// Sleep mode: a fully black screen over the app while a job runs.
//
// - Black pixels are off on AMOLED, so the screen costs almost nothing.
// - A dim progress line moves to a new spot every minute to avoid burn-in.
// - Touch is locked; holding anywhere for about 1.5 s wakes it.
// - When the job ends: vibrate, chime, and wake the screen.

import { currentJob, onJobChange, type JobState } from '../generate/jobs';
import { aboutMinutes } from '../generate/estimate';
import { h } from '../ui/h';
import { buzz, chime, unlockSound } from './completion';
import { holdWakeLock } from './wakeLock';

export const HOLD_MS = 1500;
const MOVE_EVERY_MS = 60_000;
const INTRO_MS = 5000;

let active: { close: () => void } | null = null;

export function sleepModeActive(): boolean {
  return !!active;
}

/** Call from a tap. */
export function enterSleepMode(): void {
  if (active || !currentJob()?.running) return;
  unlockSound();

  const label = h('div', { class: 'sleep-label' });
  const bar = h('div', { class: 'sleep-bar' }, h('div', { class: 'sleep-fill' }));
  const line = h('div', { class: 'sleep-line' }, label, bar);
  const ring = h('div', { class: 'sleep-ring', hidden: true });
  const intro = h(
    'div',
    { class: 'sleep-intro' },
    h('p', null, h('strong', null, 'Sleep mode')),
    h('p', null, 'The screen will go black. Generation keeps running.'),
    h('p', null, 'To wake it, press and hold anywhere for 1.5 seconds.'),
    h('p', { class: 'warn' }, 'Pressing the power button or switching apps pauses the job. For long jobs, plug the phone in.'),
  );
  // The job already holds the wake lock; asking again from this tap covers a browser that refused it earlier.
  void holdWakeLock().then((ok) => {
    if (ok) return;
    intro.append(h('p', { class: 'warn' }, "This browser won't keep the screen on. Set Settings → Display → Screen timeout to 10 minutes or more, or the job will pause when the screen turns off."));
    // Leave the warning up long enough to read.
    intro.classList.remove('gone');
    setTimeout(() => intro.classList.add('gone'), 15_000);
  });
  const overlay = h('div', { class: 'sleep', role: 'dialog', 'aria-label': 'Sleep mode. Press and hold to wake.' }, intro, line, ring);
  document.body.append(overlay);
  document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {});
  setTimeout(() => intro.classList.add('gone'), INTRO_MS);

  // Drift.
  const move = () => {
    line.style.left = `${8 + Math.random() * 50}%`;
    line.style.top = `${10 + Math.random() * 75}%`;
  };
  move();
  const mover = setInterval(move, MOVE_EVERY_MS);

  const update = (job: JobState | null) => {
    const p = job?.progress;
    if (!job) return;
    if (!job.running) {
      finish(job);
      return;
    }
    if (!p) return;
    const fraction = (p.chaptersDone + (p.phase === 'generating' ? p.chapterFraction : 0)) / p.chaptersTotal;
    const left = p.realTimeFactor && job.remainingAudioSec !== undefined ? ` · ${aboutMinutes(job.remainingAudioSec / p.realTimeFactor)} left` : '';
    label.textContent = p.phase === 'loading-model' ? 'Loading voice…' : `Chapter ${p.chapter ?? p.chaptersDone} of ${p.chaptersTotal} · ${Math.round(fraction * 100)}%${left}`;
    (bar.firstChild as HTMLElement).style.width = `${Math.round(fraction * 100)}%`;
  };
  update(currentJob());
  const off = onJobChange(update);

  // Touch lock: one finger held still for HOLD_MS wakes the screen.
  let timer: ReturnType<typeof setTimeout> | undefined;
  let start: { x: number; y: number } | null = null;
  const pointers = new Set<number>();
  const cancel = () => {
    clearTimeout(timer);
    timer = undefined;
    start = null;
    ring.hidden = true;
    ring.classList.remove('filling');
  };
  const block = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
  };
  overlay.addEventListener('pointerdown', (e) => {
    block(e);
    pointers.add(e.pointerId);
    if (pointers.size > 1) return cancel(); // palm or pocket brush
    start = { x: e.clientX, y: e.clientY };
    ring.style.left = `${e.clientX}px`;
    ring.style.top = `${e.clientY}px`;
    ring.hidden = false;
    void ring.offsetWidth; // restart the CSS animation
    ring.classList.add('filling');
    timer = setTimeout(() => close(), HOLD_MS);
  });
  overlay.addEventListener('pointermove', (e) => {
    if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 30) cancel();
  });
  const up = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    cancel();
  };
  overlay.addEventListener('pointerup', up);
  overlay.addEventListener('pointercancel', up);
  for (const type of ['click', 'contextmenu', 'touchstart', 'touchmove', 'wheel']) overlay.addEventListener(type, block, { passive: false });

  // Swallow the Android back gesture while locked.
  history.pushState({ noteableSleep: true }, '');
  const onPop = () => history.pushState({ noteableSleep: true }, '');
  window.addEventListener('popstate', onPop);

  function finish(job: JobState) {
    buzz();
    if (!job.error) chime();
    close();
  }

  function close() {
    if (!active) return;
    active = null;
    cancel();
    clearInterval(mover);
    off();
    window.removeEventListener('popstate', onPop);
    if (history.state?.noteableSleep) history.back();
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    overlay.classList.add('waking');
    setTimeout(() => overlay.remove(), 400);
  }

  active = { close };
}

export function exitSleepMode(): void {
  active?.close();
}
