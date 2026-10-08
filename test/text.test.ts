import { describe, expect, it } from 'vitest';
import { parseGuide } from '../src/import/markdown';
import { packGroups, splitSentences, textToGroups } from '../src/tts/chunk';
import { speechPlan, spokenChars } from '../src/tts/speechText';

describe('parseGuide', () => {
  const guide = `---
title: ECON 1000 Week 3 — Opportunity Cost
collection: ECON 1000
mode: teach
voice: am_michael
sources: [Week 3 slides.pdf, Mankiw ch. 1]
---

## Overview
Plain-language framing.

## Key terms
- **Opportunity cost:** the value of the next best alternative given up.
`;

  it('reads the header and splits at ##', () => {
    const g = parseGuide(guide, 'x.md');
    expect(g.meta).toEqual({
      title: 'ECON 1000 Week 3 — Opportunity Cost',
      collection: 'ECON 1000',
      mode: 'teach',
      voice: 'am_michael',
      sources: ['Week 3 slides.pdf', 'Mankiw ch. 1'],
    });
    expect(g.chapters.map((c) => c.title)).toEqual(['Overview', 'Key terms']);
    expect(g.chapters[0].markdown).toBe('## Overview\nPlain-language framing.\n');
  });

  it('defaults without a header: title from # heading, General, narrate', () => {
    const g = parseGuide('# My Notes\n\nIntro text.\n\n## One\nA.\n', 'file.md');
    expect(g.meta).toMatchObject({ title: 'My Notes', collection: 'General', mode: 'narrate' });
    expect(g.chapters.map((c) => c.title)).toEqual(['Introduction', 'One']);
    expect(g.chapters[0].markdown).toBe('## Introduction\n\nIntro text.\n');
  });

  it('uses the file name when there is no title, and one chapter when there is no ##', () => {
    const g = parseGuide('Just some text.\n', 'Lecture 4.md');
    expect(g.meta.title).toBe('Lecture 4');
    expect(g.chapters).toHaveLength(1);
    expect(g.chapters[0].title).toBe('Lecture 4');
  });

  it('ignores ## inside code fences and drops an empty introduction', () => {
    const g = parseGuide('## A\n```\n## not a heading\n```\n## B\nb\n', 'f.md');
    expect(g.chapters.map((c) => c.title)).toEqual(['A', 'B']);
  });

  it('warns about a broken header but still imports', () => {
    const g = parseGuide('---\ntitle: [unclosed\n---\n## A\na\n', 'f.md');
    expect(g.warnings.length).toBe(1);
    expect(g.chapters).toHaveLength(1);
  });
});

describe('chunking', () => {
  it('splits sentences but not abbreviations or decimals', () => {
    expect(splitSentences('Dr. Smith paid $3.50 for it. Then, e.g. lunch. Done!')).toEqual([
      'Dr. Smith paid $3.50 for it.',
      'Then, e.g. lunch.',
      'Done!',
    ]);
  });

  it('packs sentences into groups of at most 300 characters without losing text', () => {
    const text = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} talks about opportunity cost.`).join(' ');
    const groups = textToGroups(text);
    expect(groups.every((g) => g.length <= 300)).toBe(true);
    expect(groups.join(' ')).toBe(text);
  });

  it('breaks an over-long sentence at commas', () => {
    const long = Array.from({ length: 30 }, (_, i) => `clause ${i}`).join(', ') + '.';
    const groups = packGroups([long], 100);
    expect(groups.every((g) => g.length <= 100)).toBe(true);
    expect(groups.join(' ')).toBe(long);
  });
});

describe('speechPlan', () => {
  it('reads headings, strips markdown, says Question and Answer, and honours [pause Ns]', () => {
    const plan = speechPlan('## Review questions\n**Q:** Does it go up?\n\n[pause 5s]\n\n**A:** It goes *up*, see [link](http://x).\n');
    const said = plan.filter((s) => 'say' in s).map((s) => (s as { say: string }).say);
    expect(said).toEqual(['Review questions.', 'Question. Does it go up?', 'Answer. It goes up, see link.']);
    expect(plan).toContainEqual({ pause: 5 });
    expect(said.join(' ')).not.toMatch(/[*#[\]]|http/);
  });

  it('reads list items as sentences and skips code blocks', () => {
    const plan = speechPlan('- first item\n- second item\n\n```\ncode()\n```\n');
    const said = plan.filter((s) => 'say' in s).map((s) => (s as { say: string }).say);
    expect(said).toEqual(['first item.', 'second item.']);
    expect(spokenChars(plan)).toBe('first item.second item.'.length);
  });

  it('never has two pauses in a row', () => {
    const plan = speechPlan('## A\n\n[pause 2s]\n\nText.');
    for (let i = 1; i < plan.length; i++) expect('pause' in plan[i] && 'pause' in plan[i - 1]).toBe(false);
  });
});

describe('teach-mode answer pauses', () => {
  const pauses = (md: string) => speechPlan(md).filter((s) => 'pause' in s).map((s) => (s as { pause: number }).pause);
  const said = (md: string) => speechPlan(md).filter((s) => 'say' in s).map((s) => (s as { say: string }).say);

  it('adds a 5 s pause before every answer, even without a marker', () => {
    const md = '## Review questions\n\n**Q:** One?\n\n**A:** Yes.\n\n**Q:** Two?\n\n**A:** No.\n';
    expect(said(md)).toEqual(['Review questions.', 'Question. One?', 'Answer. Yes.', 'Question. Two?', 'Answer. No.']);
    const plan = speechPlan(md);
    const before = (text: string) => plan[plan.findIndex((s) => 'say' in s && s.say === text) - 1];
    expect(before('Answer. Yes.')).toEqual({ pause: 5 });
    expect(before('Answer. No.')).toEqual({ pause: 5 });
  });

  it('handles Q and A in the same paragraph', () => {
    const plan = speechPlan('**Q:** Up or down? **A:** Up.');
    expect(plan.filter((s) => 'say' in s)).toEqual([{ say: 'Question. Up or down?' }, { say: 'Answer. Up.' }]);
    expect(plan[plan.findIndex((s) => 'say' in s && s.say.startsWith('Answer')) - 1]).toEqual({ pause: 5 });
  });

  it("an author's [pause Ns] wins over the default, shorter or longer", () => {
    expect(pauses('**Q:** a?\n\n[pause 2s]\n\n**A:** b.')).toContain(2);
    expect(pauses('**Q:** a?\n\n[pause 2s]\n\n**A:** b.')).not.toContain(5);
    expect(pauses('**Q:** a? [pause 8s] **A:** b.')).toContain(8);
  });
});
