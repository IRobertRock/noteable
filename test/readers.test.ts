// @vitest-environment jsdom
// jsdom, not happy-dom: these readers need namespace-aware XML parsing, as in real browsers.
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { cleanDoc } from '../src/import/cleanup';
import { readDocx } from '../src/import/readers/docx';
import { readEpub } from '../src/import/readers/epub';
import { readMarkdownDoc } from '../src/import/readers/markdownDoc';
import { readPdf, type PdfDoc } from '../src/import/readers/pdf';
import { readPptx } from '../src/import/readers/pptx';
import { buildDocx, buildEpub, buildPptx, buildReadingPdf } from './fixtures/build';

const allText = (chapters: { markdown: string }[]) => chapters.map((c) => c.markdown).join('\n');

describe('PPTX', () => {
  const deck = [
    { title: 'ECON 1000: Week 3', body: ['Opportunity cost and trade-offs'], layout: 'title' as const },
    { title: 'What is opportunity cost?', body: ['The next best alternative given up', 'Applies to time as well as money'], notes: 'Start with the concert example.' },
    { title: 'Example', body: ['Wage $20/hour', 'Concert takes 3 hours'] },
    { title: 'Trade-offs', body: ['Firms face them too'], layout: 'secHead' as const },
    { title: 'The PPF', body: ['Shows efficient combinations'], notes: 'Draw the curve on the board.' },
  ];

  it('reads slides and notes in order and drops slide numbers and repeated footers', async () => {
    const doc = await readPptx(await buildPptx(deck), 'week3.pptx');
    const chapters = cleanDoc(doc);
    const text = allText(chapters);
    expect(doc.title).toBe('ECON 1000: Week 3');
    expect(text.indexOf('What is opportunity cost?')).toBeLessThan(text.indexOf('Start with the concert example.'));
    expect(text.indexOf('Start with the concert example.')).toBeLessThan(text.indexOf('### Example'));
    expect(text).not.toMatch(/ECON 1000 – Fall 2026/);
    expect(text).not.toMatch(/^\d+$/m);
    expect(doc.removed.filter((r) => r.reason === 'slide number')).toHaveLength(5);
    expect(doc.removed.filter((r) => r.reason === 'header or footer')).toHaveLength(5);
  });

  it('catches a repeated footer even in a two-slide deck', async () => {
    const text = allText(cleanDoc(await readPptx(await buildPptx(deck.slice(0, 2)), 'short.pptx')));
    expect(text).not.toContain('Fall 2026');
  });

  it('splits chapters at title / section-header slides when there are no sections', async () => {
    const chapters = cleanDoc(await readPptx(await buildPptx(deck), 'week3.pptx'));
    expect(chapters.map((c) => c.title)).toEqual(['ECON 1000: Week 3', 'Trade-offs']);
  });

  it('uses PowerPoint sections when the deck has them', async () => {
    const chapters = cleanDoc(
      await readPptx(
        await buildPptx(deck, [
          { name: 'Intro', slides: [1, 2] },
          { name: 'Examples', slides: [3, 4, 5] },
        ]),
        'w.pptx',
      ),
    );
    expect(chapters.map((c) => c.title)).toEqual(['Intro', 'Examples']);
  });

  it('falls back to groups of 10 slides', async () => {
    const plain = Array.from({ length: 23 }, (_, i) => ({ title: `Slide topic ${i + 1}`, body: [`Point ${i + 1}`] }));
    const chapters = cleanDoc(await readPptx(await buildPptx(plain), 'long.pptx'));
    expect(chapters.map((c) => c.title)).toEqual(['Slide topic 1', 'Slide topic 11', 'Slide topic 21']);
  });
});

describe('DOCX', () => {
  it('keeps headings, reads footnotes at the end of their section, and strips citations', async () => {
    const doc = await readDocx(
      await buildDocx([
        { style: 'Heading1', text: 'Supply' },
        { text: 'Supply curves slope up (Marshall, 1890).', footnote: 'Usually, but not always.' },
        { text: 'More on supply.' },
        { style: 'Heading1', text: 'Demand' },
        { text: 'Demand curves slope down [2].' },
        { style: 'Heading1', text: 'References' },
        { text: 'Marshall, A. (1890). Principles of Economics.' },
      ]),
      'notes.docx',
    );
    const chapters = cleanDoc(doc);
    expect(chapters.map((c) => c.title)).toEqual(['Supply', 'Demand']);
    expect(chapters[0].markdown).toBe('## Supply\n\nSupply curves slope up.\n\nMore on supply.\n\nNotes for this section.\n\nNote 1: Usually, but not always.\n');
    expect(chapters[1].markdown).toBe('## Demand\n\nDemand curves slope down.\n');
  });
});

describe('EPUB', () => {
  it('makes one chapter per spine document, titled from the nav, skipping the cover', async () => {
    const long = (s: string) => `<p>${s} ${'More text about the topic. '.repeat(20)}</p>`;
    const doc = await readEpub(
      await buildEpub('A Small Book', [
        { title: 'Chapter One', html: `<h1>Chapter One</h1>${long('First chapter.')}<aside epub:type="footnote"><p>1 A note.</p></aside>` },
        { title: 'Chapter Two', html: `<h1>Chapter Two</h1>${long('Second chapter.')}` },
      ]),
      'book.epub',
    );
    const chapters = cleanDoc(doc);
    expect(doc.title).toBe('A Small Book');
    expect(chapters.map((c) => c.title)).toEqual(['Chapter One', 'Chapter Two']);
    expect(chapters[0].markdown).toMatch(/^## Chapter One\n\nCover\n\nFirst chapter\./);
    expect(chapters[0].markdown).toMatch(/Notes for this section\.\n\nNote 1: A note\.\n$/);
    expect(chapters[0].markdown.match(/Chapter One/g)).toHaveLength(1);
  });
});

describe('Google Doc (markdown export)', () => {
  it('cleans citations and splits at repeated headings', () => {
    const chapters = cleanDoc(readMarkdownDoc('# Lecture notes\n\n## Part A\n\nText (Smith, 2019).\n\n## Part B\n\n- a point\n- **bold** point\n', 'Lecture notes'));
    expect(chapters.map((c) => c.title)).toEqual(['Part A', 'Part B']);
    expect(chapters[0].markdown).toBe('## Part A\n\nText.\n');
    expect(chapters[1].markdown).toBe('## Part B\n\na point\n\nbold point\n');
  });
});

describe('PDF (text layer, via pdf.js in Node)', () => {
  let pdfjs: { getDocument(o: object): { promise: Promise<unknown> }; GlobalWorkerOptions: { workerSrc: string } };
  beforeAll(async () => {
    pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as never;
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs')).href;
  });

  it('drops the running header, page numbers, citations and reference list; reads the footnote; mends hyphens', async () => {
    const data = new Uint8Array(await buildReadingPdf());
    const doc = (await pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: false }).promise) as PdfDoc;
    const raw = await readPdf(doc, 'reading.pdf');
    const chapters = cleanDoc(raw);
    const text = allText(chapters);

    expect(raw.title).toBe('Opportunity Cost Reading');
    expect(chapters.map((c) => c.title)).toEqual(['1. Opportunity cost', '2. Trade-offs']);
    expect(text).toContain('When you spend an evening studying, you give up whatever else you might have done.');
    expect(text).toContain('Note 1: This includes rest, which also has value.');
    expect(text).not.toMatch(/ECON 1000|Mankiw|Smith & Jones|\[3\]|¹|References/);
    expect(text).not.toMatch(/^\d$/m);
    const reasons = chapters.flatMap((c) => c.removed.map((r) => r.reason));
    expect(reasons.filter((r) => r === 'page number')).toHaveLength(3);
    expect(reasons.filter((r) => r === 'header or footer')).toHaveLength(3);
    expect(reasons).toContain('references');
  });

  it('says a scanned PDF needs OCR when none is available', async () => {
    const empty: PdfDoc = {
      numPages: 2,
      getPage: async () => ({ getViewport: () => ({ width: 612, height: 792 }), getTextContent: async () => ({ items: [] }) }),
      getOutline: async () => null,
      getDestination: async () => null,
      getPageIndex: async () => 0,
      getMetadata: async () => ({}),
    };
    await expect(readPdf(empty, 'scan.pdf')).rejects.toThrow(/scan/);
  });

  it('uses OCR lines for a scanned PDF', async () => {
    const empty: PdfDoc = {
      numPages: 1,
      getPage: async () => ({ getViewport: () => ({ width: 612, height: 792 }), getTextContent: async () => ({ items: [] }) }),
      getOutline: async () => null,
      getDestination: async () => null,
      getPageIndex: async () => 0,
      getMetadata: async () => ({}),
    };
    const raw = await readPdf(empty, 'scan.pdf', {
      ocr: async () => [
        {
          page: 1,
          height: 792,
          lines: [
            { text: 'Scanned paragraph one,', page: 1, x: 72, y: 100, fontSize: 11, paraStart: true },
            { text: 'continued.', page: 1, x: 72, y: 114, fontSize: 11 },
            { text: 'Second paragraph (Lee, 2020).', page: 1, x: 72, y: 128, fontSize: 11, paraStart: true },
          ],
        },
      ],
    });
    expect(raw.ocrPages).toBe(1);
    expect(cleanDoc(raw)[0].markdown).toBe('## scan\n\nScanned paragraph one, continued.\n\nSecond paragraph.\n');
  });
});
