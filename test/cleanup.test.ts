import { describe, expect, it } from 'vitest';
import { cleanDoc } from '../src/import/cleanup';
import { splitChapters } from '../src/import/cleanup/chapters';
import { stripCitations } from '../src/import/cleanup/citations';
import { NOTES_INTRO, placeFootnotes } from '../src/import/cleanup/footnotes';
import { isPageNumber, stripHeadersFooters } from '../src/import/cleanup/headersFooters';
import { dropReferences } from '../src/import/cleanup/references';
import { joinLines, linesToBlocks } from '../src/import/cleanup/rejoin';
import type { Block, PageLines, TextLine } from '../src/import/types';

// y given as a fraction of a 792-point page, stored in points.
const line = (text: string, page: number, y: number, fontSize = 10, x = 72): TextLine => ({ text, page, y: y * 792, fontSize, x });

describe('rule 1: page numbers, headers and footers', () => {
  it('recognises page numbers but not headings that contain numbers', () => {
    for (const t of ['12', 'Page 12', '12 of 40', '3 / 9', 'xiv', '- 7 -', 'Slide 4']) expect(isPageNumber(t), t).toBe(true);
    for (const t of ['Chapter 3', '1. Introduction', '2019 was a good year', 'Figure 2']) expect(isPageNumber(t), t).toBe(false);
  });

  it('drops a running header/footer that repeats on most pages, digits ignored', () => {
    const pages: PageLines[] = [1, 2, 3, 4].map((p) => ({
      page: p,
      height: 792,
      lines: [
        line('ECON 1000 – Fall 2026 – Week 3', p, 0.05, 8),
        line(`Body text on page ${p} that is unique.`, p, 0.2),
        line('More body text.', p, 0.25),
        line(`${p + 10}`, p, 0.95, 8),
      ],
    }));
    const { pages: out, removed } = stripHeadersFooters(pages);
    expect(out.every((p) => p.lines.length === 2)).toBe(true);
    expect(removed.filter((r) => r.reason === 'header or footer')).toHaveLength(4);
    expect(removed.filter((r) => r.reason === 'page number').map((r) => r.text)).toEqual(['11', '12', '13', '14']);
  });

  it('keeps a first line that only appears once', () => {
    const pages: PageLines[] = [1, 2, 3].map((p) => ({ page: p, height: 792, lines: [line(p === 1 ? 'Introduction' : `Text ${p} start`, p, 0.1), line('body', p, 0.5)] }));
    expect(stripHeadersFooters(pages).pages[0].lines[0].text).toBe('Introduction');
  });
});

describe('rule 2: citations', () => {
  const cases: [string, string][] = [
    ['Prices rose (Smith, 2019).', 'Prices rose.'],
    ['Prices rose (Smith & Jones, 2019, p. 4) sharply.', 'Prices rose sharply.'],
    ['As shown (Smith et al., 2019; Lee, 2020), demand fell.', 'As shown, demand fell.'],
    ['Chicago style (Mankiw 2021, 45–47) works too.', 'Chicago style works too.'],
    ['Numbered refs [12] and ranges [3–5] and lists [1, 4].', 'Numbered refs and ranges and lists.'],
    ['Smith (2019) argues otherwise.', 'Smith argues otherwise.'],
    ['Superscript markers³ go.', 'Superscript markers go.'],
    ['Organisations (World Bank, 2020a) count.', 'Organisations count.'],
    ['Older work (Keynes, 1936; see also Hicks, 1937) holds.', 'Older work holds.'],
  ];
  for (const [input, expected] of cases) {
    it(`removes: ${input}`, () => expect(stripCitations(input).text).toBe(expected));
  }

  const keep = [
    'The (see 2019 report) is attached.',
    'Revenue grew (about 20%) in 2019.',
    'GDP (gross domestic product) measures output.',
    'Use option [a] or [b].',
    'In 2019 prices fell (sharply).',
  ];
  for (const k of keep) {
    it(`keeps: ${k}`, () => expect(stripCitations(k).text).toBe(k));
  }
});

describe('rule 3: references', () => {
  it('drops from the References heading to the next heading of the same level', () => {
    const blocks: Block[] = [
      { kind: 'heading', text: 'Conclusion', level: 1 },
      { kind: 'para', text: 'Done.' },
      { kind: 'heading', text: 'References', level: 1 },
      { kind: 'para', text: 'Smith, J. (2019). A book.' },
      { kind: 'heading', text: 'Sub', level: 2 },
      { kind: 'para', text: 'Lee, K. (2020). Another.' },
      { kind: 'heading', text: 'Appendix A', level: 1 },
      { kind: 'para', text: 'Kept.' },
    ];
    const { blocks: out, removed } = dropReferences(blocks);
    expect(out.map((b) => b.text)).toEqual(['Conclusion', 'Done.', 'Appendix A', 'Kept.']);
    expect(removed).toHaveLength(4);
  });

  it('also catches "Works Cited" and "Bibliography" at the end', () => {
    for (const h of ['Works Cited', 'Bibliography', '7. References']) {
      const { blocks } = dropReferences([{ kind: 'para', text: 'x' }, { kind: 'heading', text: h, level: 2 }, { kind: 'para', text: 'y' }]);
      expect(blocks.map((b) => b.text), h).toEqual(['x']);
    }
  });
});

describe('rule 4: footnotes', () => {
  it('reads notes at the end of their section, introduced as "Notes for this section."', () => {
    const out = placeFootnotes([
      { kind: 'heading', text: 'One', level: 1 },
      { kind: 'para', text: 'Text with a note.' },
      { kind: 'footnote', text: '1 The note itself.' },
      { kind: 'para', text: 'More text.' },
      { kind: 'heading', text: 'Two', level: 1 },
      { kind: 'para', text: 'Second.' },
    ]);
    expect(out.map((b) => b.text)).toEqual(['One', 'Text with a note.', 'More text.', NOTES_INTRO, 'Note 1: The note itself.', 'Two', 'Second.']);
  });
});

describe('rule 5: rejoin', () => {
  it('mends hyphenated words but keeps real hyphens', () => {
    expect(joinLines('the econ-', 'omy grew')).toBe('the economy grew');
    expect(joinLines('a self-', 'interested agent')).toBe('a self-interested agent');
    expect(joinLines('the year 2019 -', 'Next')).toBe('the year 2019 - Next');
    expect(joinLines('ends here.', 'Next line')).toBe('ends here. Next line');
  });

  it('merges broken lines into paragraphs and finds headings and footnotes', () => {
    const pages: PageLines[] = [
      {
        page: 1,
        height: 792,
        lines: [
          line('1. Opportunity cost', 1, 0.1, 16),
          line('Every choice has a hidden price. When you spend an eve-', 1, 0.15),
          line('ning studying, you give something up.', 1, 0.17),
          line('A new paragraph starts here after a gap.', 1, 0.23),
          line('1 A footnote in small type.', 1, 0.9, 7),
        ],
      },
    ];
    const blocks = linesToBlocks(pages);
    expect(blocks).toEqual([
      { kind: 'heading', text: '1. Opportunity cost', level: 1, page: 1 },
      { kind: 'para', text: 'Every choice has a hidden price. When you spend an evening studying, you give something up.', page: 1 },
      { kind: 'para', text: 'A new paragraph starts here after a gap.', page: 1 },
      { kind: 'footnote', text: '1 A footnote in small type.', page: 1 },
    ]);
  });

  it('carries a sentence across a page break', () => {
    const blocks = linesToBlocks([
      { page: 1, height: 792, lines: [line('The sentence starts on one page and', 1, 0.8)] },
      { page: 2, height: 792, lines: [line('finishes on the next.', 2, 0.1)] },
    ]);
    expect(blocks.map((b) => b.text)).toEqual(['The sentence starts on one page and finishes on the next.']);
  });
});

describe('rule 6: chapters', () => {
  it('splits at the top heading level that repeats, ignoring a lone title heading', () => {
    const s = splitChapters(
      [
        { kind: 'heading', text: 'Paper title', level: 1 },
        { kind: 'para', text: 'Abstract text.' },
        { kind: 'heading', text: 'Intro', level: 2 },
        { kind: 'para', text: 'a' },
        { kind: 'heading', text: 'Detail', level: 3 },
        { kind: 'para', text: 'b' },
        { kind: 'heading', text: 'Results', level: 2 },
        { kind: 'para', text: 'c' },
      ],
      'Doc',
    );
    expect(s.map((x) => x.title)).toEqual(['Introduction', 'Intro', 'Results']);
  });

  it('forced chapter breaks win', () => {
    const s = splitChapters([{ kind: 'chapter', text: 'Spine 1' }, { kind: 'para', text: 'a' }, { kind: 'heading', text: 'H', level: 1 }, { kind: 'para', text: 'b' }, { kind: 'chapter', text: 'Spine 2' }, { kind: 'para', text: 'c' }], 'Doc');
    expect(s.map((x) => x.title)).toEqual(['Spine 1', 'Spine 2']);
  });

  it('splits very long text into parts', () => {
    const blocks: Block[] = Array.from({ length: 60 }, (_, i) => ({ kind: 'para' as const, text: `${'word '.repeat(150)}${i}.` }));
    const s = splitChapters(blocks, 'Long');
    expect(s.length).toBeGreaterThan(1);
    expect(s[0].title).toBe('Long (part 1)');
  });
});

describe('chapter markdown', () => {
  it('does not repeat the chapter title as its first sub-heading', () => {
    const [c] = cleanDoc({ title: 'Week 3', removed: [], blocks: [{ kind: 'chapter', text: 'Week 3' }, { kind: 'heading', text: 'Week 3', level: 3 }, { kind: 'para', text: 'Body.' }] });
    expect(c.markdown).toBe('## Week 3\n\nBody.\n');
  });
});

describe('cleanDoc end to end', () => {
  it('produces chapter markdown with notes, and lists what it removed per chapter', () => {
    const chapters = cleanDoc({
      title: 'Reading',
      removed: [{ reason: 'page number', text: '2', page: 2 }],
      blocks: [
        { kind: 'heading', text: 'Supply', level: 1, page: 1 },
        { kind: 'para', text: 'Supply curves slope up (Smith, 2019).', page: 1 },
        { kind: 'footnote', text: '1 Usually.', page: 1 },
        { kind: 'heading', text: 'Demand', level: 1, page: 2 },
        { kind: 'para', text: 'Demand curves slope down [4].', page: 2 },
        { kind: 'heading', text: 'References', level: 1, page: 3 },
        { kind: 'para', text: 'Smith, J. (2019).', page: 3 },
      ],
    });
    expect(chapters.map((c) => c.title)).toEqual(['Supply', 'Demand']);
    expect(chapters[0].markdown).toBe(`## Supply\n\nSupply curves slope up.\n\n${NOTES_INTRO}\n\nNote 1: Usually.\n`);
    expect(chapters[0].removed.map((r) => r.reason)).toEqual(['citation']);
    expect(chapters[1].markdown).toBe('## Demand\n\nDemand curves slope down.\n');
    expect(chapters[1].removed.map((r) => r.reason).sort()).toEqual(['citation', 'page number', 'references', 'references', 'references'].slice(0, 4).sort());
  });
});
