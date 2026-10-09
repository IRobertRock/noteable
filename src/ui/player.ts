import { itemHash, readHash, type App } from '../app';
import { SKIP_SEC, type PlayerState } from '../player/player';
import { SPEEDS, type Bookmark } from '../sync/state';
import { formatDuration } from './format';
import { fill, h } from './h';
import { openCarMode } from './carMode';
import { speechSupported } from '../study/speechAnswer';
import type { AnswerResult } from '../player/player';

function answerBanner(r: AnswerResult): HTMLElement {
  if (r.score === 'error') return h('div', { class: 'banner error', role: 'status' }, r.message ?? 'Could not listen.');
  const head = r.score === 'right' ? '✓ Got it' : r.score === 'close' ? '≈ Close' : r.said ? '✗ Not quite' : '… Didn\'t catch that';
  return h(
    'div',
    { class: `banner answer-${r.score}`, role: 'status' },
    h('strong', null, head),
    r.said && h('div', { class: 'small' }, `You said: “${r.said}”`),
    h('div', { class: 'small muted' }, `Answer: ${r.expected}`),
  );
}

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
    const key = [s.entry?.item.id, s.chapter, s.playing, s.loading, s.speed, s.error, Math.round(s.duration), s.quiz?.index, s.quiz?.listening, s.quiz?.result?.score, s.quiz?.spoken, s.recap?.kind].join('|');
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
      s.quiz &&
        h(
          'div',
          { class: 'banner action' },
          h('span', null, h('strong', null, `Quiz me: question ${s.quiz.index + 1} of ${s.quiz.total}`)),
          h('button', { class: 'small', onclick: () => void app.player.quizStep(1) }, 'Next ›'),
          h('button', { class: 'small', onclick: () => app.player.stopQuiz() }, 'Stop'),
          speechSupported() &&
            h(
              'label',
              { class: 'check small' },
              h('input', {
                type: 'checkbox',
                checked: s.quiz.spoken,
                onchange: (e: Event) => {
                  const on = (e.target as HTMLInputElement).checked;
                  if (on && !confirm('Say your answer uses Google speech recognition: your spoken answer is sent to Google to be turned into text. Keep the screen on while answering. Turn it on?')) {
                    (e.target as HTMLInputElement).checked = false;
                    return;
                  }
                  app.player.setSpokenAnswers(on);
                },
              }),
              ' 🎤 Say your answer',
            ),
        ),
      s.quiz?.listening && h('div', { class: 'banner listening', role: 'status' }, '🎤 Listening… say your answer'),
      s.quiz?.result && answerBanner(s.quiz.result),
      s.recap &&
        !s.quiz &&
        h(
          'div',
          { class: 'banner action' },
          h('span', null, `It's been ${s.recap.daysAway} days. `, h('strong', null, s.recap.kind === 'chapter' ? `Play “${s.recap.title}” first?` : 'Hear the last minute again first?')),
          h('button', { class: 'small primary', onclick: () => void app.player.playRecap() }, '▶ Recap'),
          h('button', { class: 'small', onclick: () => app.player.dismissRecap() }, 'No thanks'),
        ),
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
        'label',
        { class: 'check small' },
        h('input', { type: 'checkbox', checked: app.player.skipSilence, onchange: (e: Event) => app.player.setSkipSilence((e.target as HTMLInputElement).checked) }),
        ` Skip silence at 1.25× and faster${s.speed >= 1.25 ? '' : ' (not active at this speed)'}`,
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
        h('button', { onclick: () => openCarMode(app) }, '🚗 Car mode'),
      ),
      h('h2', null, 'Bookmarks'),
      marks.length ? bookmarkList(app, marks, item.chapters, noteFor, () => (noteFor = null)) : h('p', { class: 'muted small' }, 'None yet. Tap Bookmark to save this spot.'),
      upNextList(app),
    );
  };

  tick(app.player.snapshot);
  app.onLeave(app.player.onChange(tick));
  // Bookmark changes redraw, unless a note is being typed.
  app.onLeave(app.state.onChange(() => !screen.contains(document.activeElement) && render(app.player.snapshot)));
  return screen;
}

/** Items queued to play after this one. */
function upNextList(app: App): HTMLElement {
  const ids = app.state.upNext.items;
  const save = async (next: string[]) => {
    await app.state.setUpNext(next);
    void app.state.sync().catch(() => {});
  };
  return h(
    'div',
    null,
    h('h2', null, 'Up next'),
    ids.length
      ? h(
          'ol',
          { class: 'status' },
          ids.map((id, i) => {
            const x = app.library.byId(id);
            return h(
              'li',
              null,
              h('span', { class: 'grow' }, x ? x.item.title : '(item not in this library)'),
              h('button', { class: 'small', 'aria-label': 'Move up', disabled: i === 0, onclick: () => void save(ids.map((v, j) => (j === i - 1 ? id : j === i ? ids[i - 1] : v))) }, '↑'),
              h('button', { class: 'small', 'aria-label': 'Remove from Up next', onclick: () => void save(ids.filter((v) => v !== id)) }, '✕'),
            );
          }),
        )
      : h('p', { class: 'muted small' }, 'Nothing queued. On an item, tap "Add to Up next" to keep listening when this one ends.'),
  );
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
            b.kind === 'highlight' ? `✎ “${(b.text ?? '').slice(0, 120)}${(b.text ?? '').length > 120 ? '…' : ''}” · ${title}` : `${b.chapter}. ${title} · ${formatDuration(b.positionSec)}`,
          ),
          note,
        ),
        h('button', { class: 'small', 'aria-label': 'Delete bookmark', onclick: () => void app.state.deleteBookmark(b.id).then(() => app.state.sync().catch(() => {})) }, '✕'),
      );
    }),
  );
}
