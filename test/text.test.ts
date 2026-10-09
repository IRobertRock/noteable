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
    expect(plan.filter((s) => 'say' in s)).toEqual([
      { say: 'Question. Up or down?', mark: 'q', role: 'question' },
      { say: 'Answer. Up.', mark: 'a', role: 'answer' },
    ]);
    expect(plan[plan.findIndex((s) => 'say' in s && s.say.startsWith('Answer')) - 1]).toEqual({ pause: 5 });
  });

  it("an author's [pause Ns] wins over the default, shorter or longer", () => {
    expect(pauses('**Q:** a?\n\n[pause 2s]\n\n**A:** b.')).toContain(2);
    expect(pauses('**Q:** a?\n\n[pause 2s]\n\n**A:** b.')).not.toContain(5);
    expect(pauses('**Q:** a? [pause 8s] **A:** b.')).toContain(8);
  });
});

describe('maths, tables and pronunciations', async () => {
  const { mathToWords, tableRowWithHeaders } = await import('../src/tts/mathSpeech');
  const { applyPronunciations, compileRules } = await import('../src/tts/pronounce');
  const said = (md: string, pronunciations = [] as { from: string; to: string; regex?: boolean }[]) =>
    speechPlan(md, { pronunciations }).filter((s) => 'say' in s).map((s) => (s as { say: string }).say);

  it('reads simple maths as words, leaving words and dates alone', () => {
    expect(mathToWords('Area = x^2 and volume y^3, growth e^-t')).toBe('Area equals x squared and volume y cubed, growth e to the power of minus t');
    expect(mathToWords('If MC/MR ≤ 1 then 50% ≈ π')).toBe('If MC over MR less than or equal to 1 then 50 percent approximately pi');
    expect(mathToWords('Due 1/2/2026, and/or km/h')).toBe('Due 1/2/2026, and/or km/h');
    expect(mathToWords('a/b')).toBe('a over b');
  });

  it('reads table rows with their headers', () => {
    expect(tableRowWithHeaders(['Year', 'GDP'], ['2020', '1.2 trillion'])).toBe('Year: 2020; GDP: 1.2 trillion');
    expect(said('| Year | GDP |\n| --- | --- |\n| 2020 | 1.2 |\n| 2021 | 1.3 |\n')).toEqual(['Year: 2020; GDP: 1.2.', 'Year: 2021; GDP: 1.3.']);
  });

  it('applies pronunciations: whole words, capitals exact, regex allowed', () => {
    const rules = compileRules([
      { from: 'Mankiw', to: 'Man-kyoo' },
      { from: 'PPF', to: 'P P F' },
      { from: '\\bGDP\\b', to: 'G D P', regex: true },
    ]);
    expect(applyPronunciations('Mankiw says the PPF and GDP matter; mankiwish ppf stays.', rules)).toBe('Man-kyoo says the P P F and G D P matter; mankiwish ppf stays.');
    expect(said('**Q:** What does Mankiw say?', [{ from: 'Mankiw', to: 'Man-kyoo' }])).toEqual(['Question. What does Man-kyoo say?']);
  });

  it('tags headings, questions and answers for multi-voice guides', () => {
    const plan = speechPlan('## Review\n\n**Q:** One?\n\n**A:** Yes.\n\nPlain text.');
    const roles = plan.filter((s) => 'say' in s).map((s) => (s as { role?: string }).role ?? 'narrator');
    expect(roles).toEqual(['heading', 'question', 'answer', 'narrator']);
  });
});
