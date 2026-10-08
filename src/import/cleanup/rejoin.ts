// Rule 5: rejoin words hyphenated across line breaks and merge broken lines
// into paragraphs. Also turns PDF/OCR lines into blocks: headings by font
// size, footnotes by small font at the bottom of a page.

import type { Block, PageLines, TextLine } from '../types';

// Prefixes that are usually written with a hyphen, so "self-\nesteem" stays "self-esteem".
const KEEP_HYPHEN = new Set(['self', 'well', 'non', 'co', 'pre', 'post', 'anti', 'cross', 'long', 'short', 'high', 'low', 'multi', 'semi', 'quasi', 'ex', 'full', 'part', 'mid', 'cost', 'trade', 'free', 'all']);

/** Joins two lines, mending a word broken with a hyphen. */
export function joinLines(a: string, b: string): string {
  const left = a.replace(/\s+$/, '');
  const right = b.replace(/^\s+/, '');
  const m = left.match(/([\p{L}]+)[-­]$/u);
  if (m && /^\p{Ll}/u.test(right)) {
    return KEEP_HYPHEN.has(m[1].toLowerCase()) ? `${left}${right}` : `${left.slice(0, -1)}${right}`;
  }
  return `${left} ${right}`;
}

export function normaliseText(s: string): string {
  return s
    .replace(/ﬀ/g, 'ff')
    .replace(/ﬁ/g, 'fi')
    .replace(/ﬂ/g, 'fl')
    .replace(/ﬃ/g, 'ffi')
    .replace(/ﬄ/g, 'ffl')
    .replace(/[‐‑]/g, '-')
    .replace(/ /g, ' ')
    .replace(/[ \t]+/g, ' ');
}

function quantile(xs: number[], q: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) * q)];
}
const median = (xs: number[]) => quantile(xs, 0.5);

/**
 * Turns page lines into blocks.
 * - Body size = the most common font size (weighted by characters).
 * - Lines ≥ 1.15× body size (or bold, short, on their own) become headings.
 * - Lines smaller than 0.85× body in the bottom 30% of a page that start with a number are footnotes.
 * - A new paragraph starts after a vertical gap of more than ~1.5 lines or at an indent.
 */
export function linesToBlocks(pages: PageLines[]): Block[] {
  const all = pages.flatMap((p) => p.lines);
  const sizes: number[] = [];
  for (const l of all) for (let i = 0; i < Math.min(l.text.length, 200); i += 10) sizes.push(Math.round(l.fontSize * 2) / 2);
  const body = median(sizes) || 10;
  const headingSizes = [...new Set(all.filter((l) => l.fontSize >= body * 1.15).map((l) => Math.round(l.fontSize)))].sort((a, b) => b - a);
  const levelFor = (size: number) => Math.min(3, headingSizes.indexOf(Math.round(size)) + 1) || 3;

  const blocks: Block[] = [];
  let para: { text: string; page: number; last: TextLine } | null = null;
  let footnote: Block | null = null;

  const endPara = () => {
    if (para && para.text.trim()) blocks.push({ kind: 'para', text: para.text.trim(), page: para.page });
    para = null;
  };
  const endFootnote = () => {
    if (footnote) blocks.push(footnote);
    footnote = null;
  };

  for (const p of pages) {
    // Normal line spacing: the small end of the gaps between body-size lines (paragraph gaps are bigger).
    const bodyGaps = p.lines
      .slice(1)
      .map((l, i) => ({ gap: l.y - p.lines[i].y, body: Math.abs(l.fontSize - body) < body * 0.1 && Math.abs(p.lines[i].fontSize - body) < body * 0.1 }))
      .filter((g) => g.body && g.gap > 0)
      .map((g) => g.gap);
    const typicalGap = Math.max(quantile(bodyGaps, 0.25), body * 1.05) || body * 1.2;
    p.lines.forEach((raw, i) => {
      const line = { ...raw, text: normaliseText(raw.text).trim() };
      if (!line.text) return;
      const isHeading =
        line.fontSize >= body * 1.15 ||
        (!!line.bold && line.text.length < 90 && !/[.,;:]$/.test(line.text) && (i === 0 || p.lines[i - 1].y < line.y - typicalGap * 1.4));
      const isFootnote = line.fontSize <= body * 0.85 && line.y > p.height * 0.7;

      if (isFootnote) {
        endPara();
        if (/^(?:\[?\d{1,3}\]?[.)]?|[*†‡§])\s/.test(line.text) || !footnote) {
          endFootnote();
          footnote = { kind: 'footnote', text: line.text, page: p.page };
        } else {
          footnote.text = joinLines(footnote.text, line.text);
        }
        return;
      }
      endFootnote();

      if (isHeading) {
        endPara();
        const prev = blocks[blocks.length - 1];
        // A heading wrapped over two lines.
        if (prev?.kind === 'heading' && prev.page === p.page && prev.level === levelFor(line.fontSize) && i > 0 && p.lines[i - 1].fontSize === line.fontSize) {
          prev.text = joinLines(prev.text, line.text);
        } else {
          blocks.push({ kind: 'heading', text: line.text, level: line.fontSize >= body * 1.15 ? levelFor(line.fontSize) : 3, page: p.page });
        }
        return;
      }

      const prevLine = i > 0 ? p.lines[i - 1] : null;
      const gap = prevLine ? line.y - prevLine.y : Infinity;
      const indent = prevLine ? line.x - prevLine.x : 0;
      const continues =
        para !== null &&
        !line.paraStart &&
        (para.page !== p.page
          ? !/[.!?:]["'”’)]?$/.test(para.text) // carry a sentence over a page break
          : gap <= typicalGap * 1.5 && indent < body * 1.5);
      if (continues) {
        para!.text = joinLines(para!.text, line.text);
        para!.last = line;
      } else {
        endPara();
        para = { text: line.text, page: p.page, last: line };
      }
    });
    endFootnote();
  }
  endPara();
  return blocks;
}
