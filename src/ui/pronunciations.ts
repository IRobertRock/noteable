// Account → Pronunciations: fix how names and jargon are said. Synced in
// State/pronunciations.json and used by the phone and the desktop worker.

import type { App } from '../app';
import { applyPronunciations, compileRules, readPronunciations, writePronunciations, type PronRule } from '../tts/pronounce';
import { mathToWords } from '../tts/mathSpeech';
import { fill, h } from './h';

export function pronunciationsSection(app: App): HTMLElement {
  const box = h('div', { class: 'field' });
  let rules: PronRule[] = [];
  let dirty = false;
  const status = h('span', { class: 'muted small' });

  const render = () => {
    const sample = h('input', { type: 'text', placeholder: 'Try a sentence, e.g. Mankiw draws the PPF', 'aria-label': 'Try a sentence' }) as HTMLInputElement;
    const heard = h('p', { class: 'muted small' });
    sample.addEventListener('input', () => (heard.textContent = sample.value ? `Read as: ${applyPronunciations(mathToWords(sample.value), compileRules(rules))}` : ''));
    fill(
      box,
      h('span', null, 'Pronunciations'),
      h('p', { class: 'muted small' }, 'Written word → how to say it. Whole words only; words written in capitals (PPF) match exactly. Applies the next time audio is generated.'),
      h(
        'ul',
        { class: 'status pron' },
        rules.map((r, i) => {
          const from = h('input', { type: 'text', value: r.from, placeholder: 'Mankiw', 'aria-label': 'Written as' }) as HTMLInputElement;
          const to = h('input', { type: 'text', value: r.to, placeholder: 'Man-kyoo', 'aria-label': 'Say it as' }) as HTMLInputElement;
          from.addEventListener('input', () => ((r.from = from.value), mark()));
          to.addEventListener('input', () => ((r.to = to.value), mark()));
          return h('li', null, from, h('span', { class: 'muted' }, '→'), to, h('button', { class: 'small', 'aria-label': 'Remove', onclick: () => (rules.splice(i, 1), mark(), render()) }, '✕'));
        }),
      ),
      h(
        'div',
        { class: 'buttons' },
        h('button', { class: 'small', onclick: () => (rules.push({ from: '', to: '' }), render()) }, '＋ Add'),
        h('button', { class: 'small primary', disabled: !dirty, onclick: () => void save() }, 'Save'),
      ),
      status,
      sample,
      heard,
    );
  };

  const mark = () => {
    if (dirty) return;
    dirty = true;
    render();
  };

  const save = async () => {
    status.textContent = 'Saving…';
    try {
      await app.reconnectNow();
      await writePronunciations(app.storage, rules);
      dirty = false;
      status.textContent = 'Saved. Regenerate an item to hear the change.';
      render();
    } catch (err) {
      status.textContent = `Not saved: ${(err as Error).message}`;
    }
  };

  void readPronunciations(app.storage)
    .then((r) => {
      rules = r.map((x) => ({ ...x }));
      render();
    })
    .catch(() => render());
  return box;
}
