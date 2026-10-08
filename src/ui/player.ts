import { itemHash, readHash, type App } from '../app';
import { SKIP_SEC, type PlayerState } from '../player/player';
import { SPEEDS, type Bookmark } from '../sync/state';
import { formatDuration } from './format';
import { fill, h } from './h';

/** Slim bar above the tabs while something is loaded. Updated in place so taps aren't lost. */
export function miniPlayer(app: App): HTMLElement {
  const name = h('div', { class: 'name' });
  const detail = h('div', { class: 'muted small' });
  const bar = h('progress', { max: 1, value: 0 }) as HTMLProgressElement;
  const toggle = h('button', { class: 'round', onclick: () => app.player.toggle() });
  const el = h('div', { class: 'mini-player' }, h('button', { class: 'grow mini-info', onclick: () => app.go('#/player') }, name, detail, bar), toggle);

  const render = (s: PlayerState) => {
    el.hidden = !s.entry;
    if (!s.entry) return;
    const ch = s.entry.item.chapters.find((c) => c.n === s.chapter);
    name.textContent = s.entry.item.title;
    detail.textContent = `${ch ? `${ch.n}. ${ch.title}` : ''} · ${formatDuration(s.position)}${s.speed !== 1 ? ` · ${s.speed}×` : ''}`;
    bar.value = s.duration ? s.position / s.duration : 0;
    toggle.textContent = s.loading ? '…' : s.playing ? '❚❚' : '▶';
    toggle.setAttribute('aria-label', s.playing ? 'Pause' : 'Play');
  };
  render(app.player.snapshot);
  app.onLeave(app.player.onChange(render));
  return el;
}

export function playerScreen(app: App): HTMLElement {
  const screen = h('section', { class: 'screen player' });
  let seeking = false;
  let noteFor: string | null = null;
  let scrubEl: HTMLInputElement | null = null;
  let timesEl: HTMLElement | null = null;
  let lastKey = '';

  // Position ticks only move the slider and times; everything else redraws the screen.
  const tick = (s: PlayerState) => {
    const key = [s.entry?.item.id, s.chapter, s.playing, s.loading, s.speed, s.error, Math.round(s.duration)].join('|');
    if (key !== lastKey) {
      lastKey = key;
      render(s);
      return;
    }
    if (seeking || !scrubEl || !timesEl) return;
    scrubEl.value = String(s.position);
    timesEl.children[0].textContent = formatDuration(s.position);
    timesEl.children[1].textContent = `-${formatDuration(Math.max(0, s.duration - s.position))}`;
  };

  const render = (s: PlayerState) => {
    if (seeking) return;
    if (!s.entry) {
      fill(screen, h('h1', null, 'Nothing playing'), h('p', { class: 'muted' }, 'Pick an item in the Library and press Play.'), h('a', { href: '#/' }, 'Go to Library'));
      return;
    }
    const { item, path } = s.entry;
    const ch = item.chapters.find((c) => c.n === s.chapter);
    const marks = app.state.bookmarksFor(item.id);

    const scrub = h('input', { type: 'range', min: 0, max: Math.max(1, s.duration), step: 1, value: s.position, 'aria-label': 'Position in chapter' }) as HTMLInputElement;
    scrub.addEventListener('pointerdown', () => (seeking = true));
    scrub.addEventListener('pointerup', () => queueMicrotask(() => (seeking = false)));
    scrub.addEventListener('pointercancel', () => (seeking = false));
    scrub.addEventListener('input', () => (times.firstChild!.textContent = formatDuration(Number(scrub.value))));
    scrub.addEventListener('change', () => {
      seeking = false;
      app.player.seekTo(Number(scrub.value));
    });
    const times = h('div', { class: 'times' }, h('span', null, formatDuration(s.position)), h('span', null, `-${formatDuration(Math.max(0, s.duration - s.position))}`));
    scrubEl = scrub;
    timesEl = times;

    fill(
      screen,
      h('p', { class: 'muted small' }, h('a', { href: itemHash(path) }, `${item.collection} › ${item.title}`)),
      h('h1', null, ch ? ch.title : item.title),
      h('p', { class: 'muted' }, `Chapter ${s.chapter} of ${item.chapters.length}`),
      s.error && h('p', { class: 'error', role: 'alert' }, s.error),
      scrub,
      times,
      h(
        'div',
        { class: 'transport' },
        h('button', { 'aria-label': 'Previous chapter', onclick: () => void app.player.previousChapter() }, '⏮'),
        h('button', { 'aria-label': `Back ${SKIP_SEC} seconds`, onclick: () => app.player.skip(-SKIP_SEC) }, `↺ ${SKIP_SEC}`),
        h('button', { class: 'primary big', 'aria-label': s.playing ? 'Pause' : 'Play', onclick: () => app.player.toggle() }, s.loading ? '…' : s.playing ? '❚❚' : '▶'),
        h('button', { 'aria-label': `Forward ${SKIP_SEC} seconds`, onclick: () => app.player.skip(SKIP_SEC) }, `${SKIP_SEC} ↻`),
        h('button', { 'aria-label': 'Next chapter', onclick: () => void app.player.nextChapter() }, '⏭'),
      ),
      h(
        'div',
        { class: 'speeds', role: 'group', 'aria-label': 'Speed' },
        SPEEDS.map((sp) => h('button', { class: sp === s.speed ? 'active small' : 'small', onclick: () => app.player.setSpeed(sp) }, `${sp}×`)),
      ),
      h(
        'div',
        { class: 'buttons' },
        h(
          'button',
          {
            onclick: async () => {
              const b = await app.state.addBookmark(item.id, s.chapter, s.position);
              noteFor = b.id;
              render(app.player.snapshot);
              void app.state.sync().catch(() => {});
            },
          },
          '🔖 Bookmark',
        ),
        h('button', { onclick: () => app.go(readHash(path)) }, 'Read'),
      ),
      h('h2', null, 'Bookmarks'),
      marks.length ? bookmarkList(app, marks, item.chapters, noteFor, () => (noteFor = null)) : h('p', { class: 'muted small' }, 'None yet. Tap Bookmark to save this spot.'),
    );
  };

  tick(app.player.snapshot);
  app.onLeave(app.player.onChange(tick));
  // Bookmark changes redraw, unless a note is being typed.
  app.onLeave(app.state.onChange(() => !screen.contains(document.activeElement) && render(app.player.snapshot)));
  return screen;
}

export function bookmarkList(
  app: App,
  marks: Bookmark[],
  chapters: { n: number; title: string }[],
  editing: string | null,
  doneEditing: () => void,
): HTMLElement {
  const entry = app.player.entry;
  return h(
    'ul',
    { class: 'status bookmarks' },
    marks.map((b) => {
      const title = chapters.find((c) => c.n === b.chapter)?.title ?? `Chapter ${b.chapter}`;
      const note = h('input', { type: 'text', value: b.note, placeholder: 'Add a note', 'aria-label': 'Bookmark note' }) as HTMLInputElement;
      note.addEventListener('change', () => void app.state.editBookmark(b.id, note.value).then(() => app.state.sync().catch(() => {})));
      note.addEventListener('blur', doneEditing);
      if (editing === b.id) queueMicrotask(() => note.focus());
      return h(
        'li',
        null,
        h(
          'div',
          { class: 'grow' },
          h(
            'button',
            {
              class: 'link-button',
              onclick: () => {
                const target = app.library.byId(b.itemId) ?? entry;
                if (target) void app.player.open(target, b.chapter, b.positionSec);
              },
            },
            `${b.chapter}. ${title} · ${formatDuration(b.positionSec)}`,
          ),
          note,
        ),
        h('button', { class: 'small', 'aria-label': 'Delete bookmark', onclick: () => void app.state.deleteBookmark(b.id).then(() => app.state.sync().catch(() => {})) }, '✕'),
      );
    }),
  );
}
