// Car mode: a full-screen player with very large controls, screen kept on.

import type { App } from '../app';
import { SKIP_SEC, type PlayerState } from '../player/player';
import { holdWakeLock, releaseWakeLock } from '../sleep/wakeLock';
import { formatDuration } from './format';
import { h } from './h';

export function openCarMode(app: App): void {
  const title = h('div', { class: 'car-title' });
  const sub = h('div', { class: 'car-sub' });
  const play = h('button', { class: 'car-play', 'aria-label': 'Play or pause', onclick: () => app.player.toggle() });
  const overlay = h(
    'div',
    { class: 'car', role: 'dialog', 'aria-label': 'Car mode' },
    h('button', { class: 'car-close', 'aria-label': 'Close car mode', onclick: () => close() }, '✕'),
    title,
    sub,
    h(
      'div',
      { class: 'car-row' },
      h('button', { class: 'car-btn', 'aria-label': `Back ${SKIP_SEC} seconds`, onclick: () => app.player.skip(-SKIP_SEC) }, `↺ ${SKIP_SEC}`),
      play,
      h('button', { class: 'car-btn', 'aria-label': `Forward ${SKIP_SEC} seconds`, onclick: () => app.player.skip(SKIP_SEC) }, `${SKIP_SEC} ↻`),
    ),
    h('button', { class: 'car-next', onclick: () => void (app.player.snapshot.quiz ? app.player.quizStep(1) : app.player.nextChapter()) }, 'Next chapter ⏭'),
  );

  const render = (s: PlayerState) => {
    const ch = s.entry?.item.chapters.find((c) => c.n === s.chapter);
    title.textContent = s.entry ? (ch ? ch.title : s.entry.item.title) : 'Nothing playing';
    sub.textContent = s.entry ? `${s.entry.item.title} · ${formatDuration(s.position)} / ${formatDuration(s.duration)}` : 'Pick something in the Library first.';
    play.textContent = s.loading ? '…' : s.playing ? '❚❚' : '▶';
  };
  render(app.player.snapshot);
  const off = app.player.onChange(render);
  document.body.append(overlay);
  void holdWakeLock();
  history.pushState({ noteableCar: true }, '');
  const onPop = () => close();
  window.addEventListener('popstate', onPop);

  function close() {
    off();
    window.removeEventListener('popstate', onPop);
    if (history.state?.noteableCar) history.back();
    void releaseWakeLock();
    overlay.remove();
  }
}
