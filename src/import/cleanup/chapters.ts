// Rule 6: split into chapters. Forced breaks (EPUB spine, PDF outline, PPTX
// sections) win; otherwise split at the top heading level that appears more
// than once; very long unbroken text is split into parts.

import type { Block, CleanChapter, Removed } from '../types';

/** ~25 minutes of audio. Longer chapters are split into parts at paragraph breaks. */
export const MAX_CHAPTER_CHARS = 22_000;

interface Section {
  title: string;
  blocks: Block[];
}

export function splitChapters(blocks: Block[], docTitle: string): Section[] {
  let sections: Section[];
  if (blocks.some((b) => b.kind === 'chapter')) {
    sections = splitAt(blocks, (b) => b.kind === 'chapter');
  } else {
    const levels = [1, 2, 3].filter((lv) => blocks.filter((b) => b.kind === 'heading' && b.level === lv).length >= 2);
    const top = levels[0];
    // A single level-1 heading at the very start is the document title, not a chapter.
    sections = top ? splitAt(blocks, (b) => b.kind === 'heading' && b.level === top) : [{ title: docTitle, blocks }];
  }
  sections = sections.filter((s) => s.blocks.some((b) => b.kind !== 'heading' && b.text.trim()));
  if (!sections.length) return [];
  if (sections[0].title === '') sections[0].title = sections.length === 1 ? docTitle : 'Introduction';
  return sections.flatMap((s) => splitLong(s));
}

function splitAt(blocks: Block[], isBreak: (b: Block) => boolean): Section[] {
  const out: Section[] = [{ title: '', blocks: [] }];
  for (const b of blocks) {
    if (isBreak(b)) out.push({ title: b.text.trim(), blocks: [] });
    else out[out.length - 1].blocks.push(b);
  }
  return out;
}

function splitLong(s: Section): Section[] {
  const size = (bs: Block[]) => bs.reduce((n, b) => n + b.text.length, 0);
  if (size(s.blocks) <= MAX_CHAPTER_CHARS) return [s];
  const parts: Block[][] = [[]];
  for (const b of s.blocks) {
    const cur = parts[parts.length - 1];
    if (size(cur) > MAX_CHAPTER_CHARS * 0.6 && (b.kind === 'heading' || size(cur) + b.text.length > MAX_CHAPTER_CHARS)) parts.push([b]);
    else cur.push(b);
  }
  return parts.map((blocks, i) => ({ title: `${s.title} (part ${i + 1})`, blocks }));
}

/** Section → chapter markdown. Sub-headings become ###; footnote notes are already placed. */
export function toMarkdown(s: Section, removed: Removed[]): CleanChapter {
  const lines = [`## ${s.title}`, ''];
  // Don't read the chapter title twice when its first heading says the same thing.
  const first = s.blocks.find((b) => b.text.trim());
  const same = (a: string, b: string) => a.toLowerCase().replace(/\W+/g, ' ').trim() === b.toLowerCase().replace(/\W+/g, ' ').trim();
  const blocks = first?.kind === 'heading' && same(first.text, s.title) ? s.blocks.filter((b) => b !== first) : s.blocks;
  for (const b of blocks) {
    if (b.kind === 'heading') lines.push(`### ${escapeMd(b.text)}`, '');
    else if (b.text.trim()) lines.push(escapeMd(b.text), '');
  }
  return { title: s.title, markdown: lines.join('\n').trimEnd() + '\n', removed };
}

/** Keep stray characters in source text from turning into markdown formatting. */
function escapeMd(text: string): string {
  return text
    .replace(/^(\s*)([#>+-]|\d+\.)(\s)/, '$1\\$2$3')
    .replace(/([*_`[\]])/g, '\\$1');
}
