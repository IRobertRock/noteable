// Runs the cleanup rules on a document and returns its chapters.
// (Rule 1, headers and footers, and rule 5's line joining happen earlier, in
// the PDF/OCR reader, because they need page positions.)

import type { Block, CleanChapter, RawDoc, Removed } from '../types';
import { splitChapters, toMarkdown } from './chapters';
import { stripCitations } from './citations';
import { placeFootnotes } from './footnotes';
import { dropReferences } from './references';

export function cleanDoc(doc: RawDoc): CleanChapter[] {
  // Rule 3: reference list (removed text is recorded on the block before it).
  const { blocks: kept } = dropReferences(doc.blocks);

  // Rule 2: inline citations (not in headings or chapter titles).
  const cited: Block[] = kept.map((b) => {
    if (b.kind === 'heading' || b.kind === 'chapter') return b;
    const r = stripCitations(b.text, b.page);
    return { ...b, text: r.text.trim(), removed: [...(b.removed ?? []), ...r.removed] };
  });

  // Rule 4: footnotes to the end of their section.
  const placed = placeFootnotes(cited.filter((b) => b.kind === 'chapter' || b.text.trim() || b.removed?.length));

  // Rule 6: chapters.
  const sections = splitChapters(placed, doc.title);
  if (!sections.length) return [];

  // Page-level removals (headers, footers, page numbers) go to the chapter covering that page.
  const firstPage = sections.map((s) => Math.min(...s.blocks.map((b) => b.page ?? Infinity)));
  const pageOwner = (page: number) => {
    let owner = 0;
    firstPage.forEach((p, i) => {
      if (p <= page) owner = i;
    });
    return owner;
  };
  const extra: Removed[][] = sections.map(() => []);
  for (const r of doc.removed) extra[r.page === undefined ? 0 : pageOwner(r.page)].push(r);

  return sections.map((s, i) => toMarkdown(s, dedupe([...extra[i], ...s.blocks.flatMap((b) => b.removed ?? [])])));
}

function dedupe(rs: Removed[]): Removed[] {
  const seen = new Set<string>();
  return rs.filter((r) => {
    const k = `${r.reason}|${r.page}|${r.text}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
