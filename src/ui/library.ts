// Library: collections and their items, from the local index (works offline),
// refreshed from Drive on open and every 2 minutes while visible.

import { itemHash, type App } from '../app';
import type { IndexedItem } from '../library/libraryIndex';
import { itemDuration, type Item } from '../model/item';
import { listenedFraction } from '../player/player';
import { continueListening } from '../library/continue';
import { quizSegments, shuffle } from '../study/quiz';
import { formatDuration } from './format';
import { fill, h } from './h';
import { coursePlan, examLabel, cardsDue } from '../study/plan';
import { exportNotesButton, glossaryButton, itemCards } from './studyActions';
import { sendCollection } from '../queue/jobs';

function sendAllButton(app: App, name: string, rows: IndexedItem[]): HTMLElement | false {
  const todo = rows.filter((x) => !x.item.review && x.item.chapters.some((c) => !c.excluded && c.status !== 'done'));
  if (todo.length < 2) return false;
  const status = h('span', { class: 'muted small' });
  const btn = h('button', { class: 'small' }, `🖥 Send all to desktop (${todo.length})`) as HTMLButtonElement;
  btn.addEventListener('click', async () => {
    if (!confirm(`Queue ${todo.length} items from ${name} on the desktop? Each keeps its own voice; items already queued are skipped.`)) return;
    btn.disabled = true;
    status.textContent = 'Queuing…';
    try {
      await app.reconnectNow();
      const n = await sendCollection(app.storage, rows);
      status.textContent = n ? `Queued ${n}. See the Queue tab.` : 'Everything is already queued.';
    } catch (err) {
      status.textContent = (err as Error).message;
    } finally {
      btn.disabled = false;
    }
  });
  return h('span', { class: 'inline-action' }, btn, ' ', status);
}

const REFRESH_MS = 120_000;

export function libraryScreen(app: App): HTMLElement {
  const status = h('p', { class: 'muted small' });
  const shelf = h('div');
  const body = h('div');
  const refreshBtn = h('button', { class: 'small', onclick: () => void refresh(true) }, 'Refresh');
  const searchBtn = h('button', { class: 'small', 'aria-label': 'Search', onclick: () => app.go('#/search') }, '🔍 Search');
  const today = h('div');
  const screen = h('section', { class: 'screen' }, h('div', { class: 'title-row' }, h('h1', null, 'Library'), h('div', { class: 'buttons' }, searchBtn, refreshBtn)), status, today, shelf, body);
  const examEditing = new Set<string>();
  const dueCounts = new Map<string, { n: number; entry?: IndexedItem }>();
  let dueKey = '';

  // Flashcards due per course (box 1–2), worked out in the background from chapter text.
  const countDue = async (names: string[]) => {
    const key = names.join('|') + JSON.stringify(app.state.cards).length;
    if (key === dueKey) return;
    dueKey = key;
    for (const name of names) {
      let n = 0;
      let best: { n: number; entry?: IndexedItem } = { n: 0 };
      for (const entry of app.library.items.filter((x) => x.item.collection === name && x.item.mode === 'teach')) {
        const due = cardsDue(await itemCards(app, entry), app.state.cards).length;
        n += due;
        if (due > best.n) best = { n: due, entry };
      }
      dueCounts.set(name, { n, entry: best.entry });
    }
    renderToday();
  };

  const renderToday = () => {
    const courses = app.library.collections
      .map((name) => {
        const date = app.state.examDate(name);
        const plan = date ? coursePlan(app.library.items.filter((x) => x.item.collection === name), app.state.playback, date) : null;
        return plan ? { name, plan } : null;
      })
      .filter((x) => x !== null)
      .sort((a, b) => a.plan.daysLeft - b.plan.daysLeft);
    void countDue(courses.map((c) => c.name));
    fill(
      today,
      courses.length > 0 && [
        h('h2', null, 'Today'),
        ...courses.map(({ name, plan }) => {
          const segs = quizSegments(app.library.items.filter((x) => x.item.collection === name));
          const due = dueCounts.get(name);
          return h(
            'div',
            { class: 'today' },
            h('div', { class: 'name' }, `${name} · ${examLabel(plan.daysLeft)}`),
            plan.today.length
              ? h(
                  'div',
                  { class: 'list' },
                  plan.today.map((x) => h('button', { class: 'row link', onclick: () => void app.player.open(x).then(() => app.go('#/player')) }, h('span', { class: 'grow' }, `▶ ${x.item.title}`))),
                  plan.remaining.length > plan.today.length && h('p', { class: 'muted small' }, `${plan.remaining.length - plan.today.length} more before the exam.`),
                )
              : h('p', { class: 'muted small' }, 'Everything listened to. Review with Quiz me and flashcards.'),
            h(
              'div',
              { class: 'buttons' },
              segs.length > 0 && h('button', { class: 'small', onclick: () => void app.player.startQuiz(shuffle(segs)).then(() => app.go('#/player')) }, `🎧 Quiz me (${segs.length})`),
              due && due.n > 0 && due.entry && h('button', { class: 'small', onclick: () => app.go(`#/cards/${encodeURIComponent(due.entry!.path)}`) }, `🃏 ${due.n} flashcard${due.n === 1 ? '' : 's'} due`),
            ),
          );
        }),
      ],
    );
  };

  const examControl = (name: string) => {
    const date = app.state.examDate(name);
    if (examEditing.has(name)) {
      const input = h('input', { type: 'date', value: date ?? '', 'aria-label': `${name} exam date` }) as HTMLInputElement;
      const done = async (value: string) => {
        examEditing.delete(name);
        await app.state.setExam(name, value);
        void app.state.sync().catch(() => {});
      };
      return h(
        'span',
        { class: 'inline-action' },
        input,
        h('button', { class: 'small primary', onclick: () => void done(input.value) }, 'Save'),
        date && h('button', { class: 'small', onclick: () => void done('') }, 'Remove'),
        h('button', { class: 'small', onclick: () => (examEditing.delete(name), render()) }, 'Cancel'),
      );
    }
    return h('button', { class: 'small', onclick: () => (examEditing.add(name), render()) }, date ? '📅 Exam date' : '📅 Set exam date');
  };

  const render = () => {
    renderToday();
    const items = app.library.items;
    const resume = continueListening(items, app.state.playback);
    fill(
      shelf,
      resume.length > 0 && [
        h('h2', null, 'Continue listening'),
        h(
          'div',
          { class: 'shelf' },
          resume.map((x) => {
            const pos = app.state.position(x.item.id)!;
            const ch = x.item.chapters.find((c) => c.n === pos.chapter);
            return h(
              'button',
              { class: 'shelf-card', onclick: () => void app.player.open(x).then(() => app.go('#/player')) },
              h('div', { class: 'name' }, x.item.title),
              h('div', { class: 'muted small' }, `${ch ? `Ch ${ch.n}` : ''} · ${Math.round(listenedFraction(x, pos.chapter, pos.positionSec) * 100)}%`),
              h('span', { class: 'shelf-play' }, '▶ Resume'),
            );
          }),
        ),
      ],
    );
    const byCollection = new Map<string, IndexedItem[]>();
    for (const c of app.library.collections) byCollection.set(c, []);
    for (const x of items) byCollection.set(x.item.collection, [...(byCollection.get(x.item.collection) ?? []), x]);
    const names = [...byCollection.keys()].sort((a, b) => (a === 'General' ? -1 : b === 'General' ? 1 : a.localeCompare(b)));

    if (!items.length) {
      fill(body, h('p', { class: 'muted' }, app.library.lastSynced ? 'No items yet. Import something from the Inbox.' : 'Loading…'));
    } else {
      fill(
        body,
        names.flatMap((name) => {
          const rows = (byCollection.get(name) ?? []).sort((a, b) => b.item.updatedAt.localeCompare(a.item.updatedAt));
          const segs = quizSegments(rows);
          const withAudio = rows.filter((x) => !x.item.review && x.item.chapters.some((c) => c.status === 'done')).length;
          return [
            h(
              'div',
              { class: 'collection-head' },
              h('h2', null, name),
              segs.length > 0 && h('button', { class: 'small', onclick: () => void app.player.startQuiz(shuffle(segs)).then(() => app.go('#/player')) }, `🎧 Quiz me (${segs.length})`),
              withAudio > 1 && h('button', { class: 'small', onclick: () => app.go(`#/review/${encodeURIComponent(name)}`) }, 'Build a review'),
            ),
            rows.length > 0 &&
              h(
                'div',
                { class: 'buttons collection-tools' },
                examControl(name),
                rows.some((x) => x.item.mode === 'teach' && !x.item.review) && glossaryButton(app, name, () => app.library.items.filter((x) => x.item.collection === name)),
                exportNotesButton(app, name, () => app.library.items.filter((x) => x.item.collection === name)),
                sendAllButton(app, name, rows),
              ),
            rows.length ? h('div', { class: 'list' }, rows.map((x) => itemRow(app, x))) : h('p', { class: 'muted small' }, 'Empty'),
          ];
        }),
      );
    }
    status.textContent = app.library.lastSynced ? `Updated ${app.library.lastSynced.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : navigator.onLine ? 'Checking Drive…' : 'Offline — showing what this device knows.';
  };

  const refresh = async (full = false) => {
    if (!navigator.onLine) return render();
    refreshBtn.setAttribute('disabled', '');
    try {
      await Promise.all([full ? app.library.refresh() : app.library.refreshChanges(), app.state.sync()]);
    } catch (err) {
      status.textContent = `Couldn't reach Drive: ${(err as Error).message}`;
    } finally {
      refreshBtn.removeAttribute('disabled');
    }
  };

  app.onLeave(app.library.onChange(render));
  app.onLeave(app.downloads.onChange(render));
  app.onLeave(app.state.onChange(render));
  const timer = setInterval(() => document.visibilityState === 'visible' && void refresh(), REFRESH_MS);
  app.onLeave(() => clearInterval(timer));

  render();
  void refresh();
  return screen;
}

const STATUS: Record<Item['status'], string> = { draft: 'Not generated', generating: 'Generating', ready: 'Ready', error: 'Error' };

function itemRow(app: App, entry: IndexedItem): HTMLElement {
  const { item, path } = entry;
  const done = item.chapters.filter((c) => c.status === 'done').length;
  const pos = app.state.position(item.id);
  const listened = pos ? Math.round(listenedFraction(entry, pos.chapter, pos.positionSec) * 100) : 0;
  const downloaded = app.downloads.isDownloaded(item) && done > 0;
  const detail =
    item.status === 'ready'
      ? `${formatDuration(itemDuration(item))}${listened ? ` · ${listened}% listened` : ''}`
      : `${done}/${item.chapters.length} chapters generated`;
  return h(
    'button',
    { class: 'row link', onclick: () => app.go(itemHash(path)) },
    h(
      'div',
      { class: 'grow' },
      h('div', { class: 'name' }, item.title),
      h('div', { class: 'muted small' }, `${item.mode === 'teach' ? 'Teach' : 'Narrate'} · ${detail}`),
      listened > 0 && h('progress', { max: 100, value: listened }),
    ),
    downloaded && h('span', { class: 'pill found', title: 'Downloaded on this device' }, '⬇ Offline'),
    item.status !== 'ready' && h('span', { class: `pill ${item.status === 'error' ? 'error' : 'created'}` }, STATUS[item.status]),
  );
}
