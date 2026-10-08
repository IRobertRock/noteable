// PDF → RawDoc using the PDF.js text layer, or OCR when the PDF is a scan.
// The pdfjs module is passed in so the browser and the Node tests can each
// supply their own build.

import { stripHeadersFooters } from '../cleanup/headersFooters';
import { linesToBlocks } from '../cleanup/rejoin';
import type { Block, PageLines, RawDoc, TextLine } from '../types';

/** The parts of a PDF.js document we use. */
export interface PdfDoc {
  numPages: number;
  getPage(n: number): Promise<PdfPage>;
  getOutline(): Promise<{ title: string; dest: unknown }[] | null>;
  getDestination(id: string): Promise<unknown[] | null>;
  getPageIndex(ref: unknown): Promise<number>;
  getMetadata(): Promise<{ info?: unknown }>;
}

export interface PdfPage {
  getViewport(o: { scale: number }): { width: number; height: number };
  getTextContent(): Promise<{ items: unknown[] }>;
}

interface TextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  hasEOL?: boolean;
}

/** Fewer characters per page than this (on average) means the PDF is a scan. */
export const SCANNED_CHARS_PER_PAGE = 20;

export interface PdfProgress {
  stage: 'reading' | 'ocr';
  page: number;
  pages: number;
}

export type OcrPages = (doc: PdfDoc, onProgress?: (p: PdfProgress) => void) => Promise<PageLines[]>;

export async function readPdf(
  doc: PdfDoc,
  fileName: string,
  opts: { ocr?: OcrPages; forceOcr?: boolean; onProgress?: (p: PdfProgress) => void } = {},
): Promise<RawDoc> {
  let pages: PageLines[] = [];
  let ocrPages = 0;
  if (!opts.forceOcr) {
    for (let n = 1; n <= doc.numPages; n++) {
      opts.onProgress?.({ stage: 'reading', page: n, pages: doc.numPages });
      pages.push(await pageLines(doc, n));
    }
  }
  const chars = pages.reduce((s, p) => s + p.lines.reduce((t, l) => t + l.text.trim().length, 0), 0);
  if (opts.forceOcr || chars / Math.max(1, doc.numPages) < SCANNED_CHARS_PER_PAGE) {
    if (!opts.ocr) throw new Error('This PDF is a scan and needs OCR, which is not available here.');
    pages = await opts.ocr(doc, opts.onProgress);
    ocrPages = pages.length;
  }

  const { pages: cleaned, removed } = stripHeadersFooters(pages);
  const blocks = linesToBlocks(cleaned);
  const withChapters = await applyOutline(doc, blocks);
  return { title: await pdfTitle(doc, fileName), blocks: withChapters, removed, ocrPages };
}

async function pageLines(doc: PdfDoc, n: number): Promise<PageLines> {
  const page = await doc.getPage(n);
  const { height } = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const items = (content.items as TextItem[])
    .filter((it) => typeof it.str === 'string' && it.transform)
    .map((it) => ({
      str: it.str,
      x: it.transform[4],
      y: height - it.transform[5],
      size: Math.hypot(it.transform[2], it.transform[3]) || it.height || 10,
      width: it.width,
    }))
    .filter((it) => it.str.length > 0);

  // Group items into lines by baseline, top to bottom, left to right.
  items.sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: TextLine[] = [];
  let cur: { items: typeof items; y: number; size: number } | null = null;
  const flush = () => {
    if (!cur) return;
    cur.items.sort((a, b) => a.x - b.x);
    let text = '';
    let end = -Infinity;
    for (const it of cur.items) {
      const gap = it.x - end;
      if (text && gap > it.size * 0.15 && !text.endsWith(' ') && !it.str.startsWith(' ')) text += ' ';
      text += it.str;
      end = it.x + it.width;
    }
    const size = Math.max(...cur.items.map((i) => (i.str.trim() ? i.size : 0)));
    if (text.trim()) lines.push({ text: text.replace(/\s+/g, ' ').trim(), page: n, x: cur.items[0].x, y: cur.y, fontSize: Math.round(size * 10) / 10 });
    cur = null;
  };
  for (const it of items) {
    if (cur && Math.abs(it.y - cur.y) <= Math.max(cur.size, it.size) * 0.4) {
      cur.items.push(it);
    } else {
      flush();
      cur = { items: [it], y: it.y, size: it.size };
    }
  }
  flush();
  return { page: n, height, lines };
}

/** Top-level outline entries become chapter starts, at the matching heading (or the top of their page). */
async function applyOutline(doc: PdfDoc, blocks: Block[]): Promise<Block[]> {
  const outline = await doc.getOutline().catch(() => null);
  if (!outline || outline.length < 2) return blocks;
  const starts: { title: string; page: number }[] = [];
  for (const o of outline) {
    try {
      const dest = typeof o.dest === 'string' ? await doc.getDestination(o.dest) : (o.dest as unknown[] | null);
      if (!dest?.[0]) continue;
      const ref = dest[0];
      const page = typeof ref === 'number' ? ref + 1 : (await doc.getPageIndex(ref)) + 1;
      starts.push({ title: o.title.trim(), page });
    } catch {
      // Unresolvable entry; skip it.
    }
  }
  if (starts.length < 2) return blocks;

  const out = [...blocks];
  for (const s of [...starts].reverse()) {
    const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    let at = out.findIndex((b) => b.page === s.page && b.kind === 'heading' && norm(b.text) === norm(s.title));
    if (at >= 0) {
      out[at] = { kind: 'chapter', text: s.title, page: s.page };
      continue;
    }
    at = out.findIndex((b) => (b.page ?? 0) >= s.page);
    out.splice(at < 0 ? out.length : at, 0, { kind: 'chapter', text: s.title, page: s.page });
  }
  return out;
}

async function pdfTitle(doc: PdfDoc, fileName: string): Promise<string> {
  const meta = await doc.getMetadata().catch(() => ({ info: undefined }));
  const title = (meta.info as { Title?: unknown } | undefined)?.Title;
  if (typeof title === 'string' && title.trim().length > 2 && !/^untitled|^microsoft word|\.docx?$/i.test(title.trim())) return title.trim();
  return fileName.replace(/\.[^.]+$/, '');
}
