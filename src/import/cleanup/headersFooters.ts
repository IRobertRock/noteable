// Rule 1: drop page numbers and running headers and footers.
// A line near the top or bottom that repeats (digits ignored) on most pages is a
// header or footer. A short line that is just a page number is a page number.

import type { PageLines, Removed } from '../types';

/** Up to this many lines at each end of a page, within the top/bottom band, count as header/footer candidates. */
const EDGE_LINES = 3;
const EDGE_BAND = 0.12;
const REPEAT_SHARE = 0.5;

const PAGE_NUMBER = /^(?:page\s+|p\.\s*|slide\s+)?(?:\d{1,4}|[ivxlcdm]{1,7})(?:\s*(?:of|\/)\s*\d{1,4})?$/i;
const DASHED_NUMBER = /^[-–—]\s*\d{1,4}\s*[-–—]$/;

export function isPageNumber(text: string): boolean {
  const t = text.trim();
  return PAGE_NUMBER.test(t) || DASHED_NUMBER.test(t);
}

/** Digits → #, case and spacing folded, so "ECON 1000 · Week 3 · 12" matches "ECON 1000 · Week 3 · 13". */
export function normaliseEdgeLine(text: string): string {
  return text.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
}

export function stripHeadersFooters(pages: PageLines[]): { pages: PageLines[]; removed: Removed[] } {
  const removed: Removed[] = [];
  const counts = new Map<string, number>();
  const edgeIndexes = (p: PageLines) => {
    const idx = new Set<number>();
    const n = p.lines.length;
    for (let i = 0; i < Math.min(EDGE_LINES, n); i++) {
      if (p.lines[i].y <= p.height * EDGE_BAND) idx.add(i);
      if (p.lines[n - 1 - i].y >= p.height * (1 - EDGE_BAND)) idx.add(n - 1 - i);
    }
    return idx;
  };

  for (const p of pages) {
    const seen = new Set<string>();
    for (const i of edgeIndexes(p)) {
      const key = normaliseEdgeLine(p.lines[i].text);
      if (key.length < 2 || seen.has(key)) continue;
      seen.add(key);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const minRepeats = Math.max(3, Math.ceil(pages.length * REPEAT_SHARE));
  const repeated = new Set([...counts].filter(([, n]) => n >= minRepeats).map(([k]) => k));

  const out = pages.map((p) => {
    const edges = edgeIndexes(p);
    const lines = p.lines.filter((line, i) => {
      if (!edges.has(i)) return true;
      if (isPageNumber(line.text)) {
        removed.push({ reason: 'page number', text: line.text.trim(), page: p.page });
        return false;
      }
      if (repeated.has(normaliseEdgeLine(line.text))) {
        removed.push({ reason: 'header or footer', text: line.text.trim(), page: p.page });
        return false;
      }
      return true;
    });
    return { ...p, lines };
  });
  return { pages: out, removed };
}
