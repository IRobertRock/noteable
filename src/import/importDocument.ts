// Any supported file(s) → one Library item. Several files make a course pack:
// each source becomes one or more chapters, in the order given.

import { DEFAULT_VOICE } from '../model/voices';
import type { Item } from '../model/item';
import { GOOGLE_DOC, GOOGLE_SLIDES, type Storage } from '../storage/Storage';
import { cleanDoc } from './cleanup';
import { createItem, type NewChapter, type SourceFile } from './createItem';
import { parseGuide } from './markdown';
import { readDocx } from './readers/docx';
import { readEpub } from './readers/epub';
import { readMarkdownDoc } from './readers/markdownDoc';
import { readPptx } from './readers/pptx';
import type { OcrPages, PdfDoc, PdfProgress } from './readers/pdf';
import type { RawDoc } from './types';

export type SourceRef =
  /** A file inside Noteable/ (the Inbox); moved into the item's sources/. */
  | { kind: 'storage'; path: string; id: string; name: string; mimeType?: string }
  /** A file elsewhere in Drive; copied into sources/. */
  | { kind: 'drive'; id: string; name: string; mimeType: string }
  /** Picked from the device. */
  | { kind: 'upload'; file: File };

export type Format = 'pdf' | 'docx' | 'pptx' | 'epub' | 'markdown' | 'gdoc' | 'gslides';

const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

export function formatOf(name: string, mimeType = ''): Format | null {
  if (mimeType === GOOGLE_DOC) return 'gdoc';
  if (mimeType === GOOGLE_SLIDES) return 'gslides';
  const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
  if (ext === 'pdf' || mimeType === 'application/pdf') return 'pdf';
  if (ext === 'docx') return 'docx';
  if (ext === 'pptx') return 'pptx';
  if (ext === 'epub') return 'epub';
  if (['md', 'markdown', 'txt'].includes(ext) || mimeType.startsWith('text/')) return 'markdown';
  return null;
}

export const FORMAT_LABEL: Record<Format, string> = {
  pdf: 'PDF',
  docx: 'Word',
  pptx: 'PowerPoint',
  epub: 'EPUB',
  markdown: 'Text',
  gdoc: 'Google Doc',
  gslides: 'Google Slides',
};

/** What the file picker accepts. */
export const ACCEPT = '.pdf,.docx,.pptx,.epub,.md,.markdown,.txt';

export interface PdfTools {
  open(data: ArrayBuffer): Promise<PdfDoc>;
  ocr: OcrPages;
}

export interface ImportOptions {
  title?: string;
  collection?: string;
  defaultVoice?: string;
  forceOcr?: boolean;
  onProgress?: (message: string, fraction?: number) => void;
  /** Injected so tests can use Node's pdf.js; the app passes the browser build. */
  pdf?: PdfTools;
  /** Extra item.json fields (e.g. Zotero details). */
  extra?: Partial<Item>;
}

export interface DocumentImport {
  itemPath: string;
  chapters: number;
  removed: number;
  ocrPages: number;
}

export async function importDocuments(storage: Storage, sources: SourceRef[], opts: ImportOptions = {}): Promise<DocumentImport> {
  if (!sources.length) throw new Error('Nothing to import.');
  const chapters: NewChapter[] = [];
  const files: SourceFile[] = [];
  let ocrPages = 0;
  let firstTitle = '';
  const pack = sources.length > 1;

  for (const [i, src] of sources.entries()) {
    const name = src.kind === 'upload' ? src.file.name : src.name;
    const mimeType = src.kind === 'upload' ? src.file.type : (src.mimeType ?? '');
    const format = formatOf(name, mimeType);
    if (!format) throw new Error(`${name}: this file type can't be imported yet.`);
    const step = (msg: string, f?: number) => opts.onProgress?.(pack ? `${i + 1}/${sources.length} · ${msg}` : msg, f);
    step(`Reading ${name}…`);

    const { blob, storedName } = await fetchSource(storage, src, format);
    const read = await readFormat(format, blob, name, { ...opts, onProgress: step });
    ocrPages += read.ocrPages ?? 0;
    firstTitle ||= read.title;
    for (const c of read.chapters) {
      // In a pack, name chapters by their source when the source is a single chapter.
      const title = pack && read.chapters.length === 1 ? read.title : c.title;
      chapters.push({ ...c, title, markdown: c.markdown.replace(/^## .*$/m, `## ${title}`) });
    }
    files.push(src.kind === 'storage' && !storedName ? { name, movePath: src.path } : { name: storedName ?? name, blob });
  }

  opts.onProgress?.('Saving to your library…');
  const removed = chapters.reduce((n, c) => n + (c.removed?.length ?? 0), 0);
  const { itemPath } = await createItem(storage, {
    title: opts.title?.trim() || (pack ? `${firstTitle} (pack)` : firstTitle),
    collection: opts.collection || 'General',
    mode: 'narrate',
    voice: opts.defaultVoice ?? DEFAULT_VOICE,
    chapters,
    sources: files,
    ocr: ocrPages > 0,
    extra: opts.extra,
  });
  return { itemPath, chapters: chapters.length, removed, ocrPages };
}

/** Bytes for a source. Google files are exported; the export is what gets kept in sources/. */
async function fetchSource(storage: Storage, src: SourceRef, format: Format): Promise<{ blob: Blob; storedName?: string }> {
  if (src.kind === 'upload') return { blob: src.file };
  if (format === 'gdoc' || format === 'gslides') {
    if (!storage.exportById) throw new Error('Google Docs import needs Google Drive storage.');
    const mime = format === 'gdoc' ? 'text/markdown' : PPTX_MIME;
    const blob = await storage.exportById(src.id, mime);
    return { blob, storedName: `${src.name}.${format === 'gdoc' ? 'md' : 'pptx'}` };
  }
  if (src.kind === 'storage') return { blob: await storage.read(src.path) };
  if (!storage.readById) throw new Error('Drive import needs Google Drive storage.');
  return { blob: await storage.readById(src.id) };
}

export interface ReadResult {
  title: string;
  chapters: NewChapter[];
  ocrPages?: number;
}

export async function readFormat(format: Format, blob: Blob, name: string, opts: ImportOptions): Promise<ReadResult> {
  const fromRaw = (raw: RawDoc): ReadResult => ({ title: raw.title, chapters: cleanDoc(raw), ocrPages: raw.ocrPages });
  switch (format) {
    case 'markdown': {
      // Plain notes and guides keep their own ## chapters.
      const g = parseGuide(await blob.text(), name);
      return { title: g.meta.title, chapters: g.chapters };
    }
    case 'gdoc':
      return fromRaw(readMarkdownDoc(await blob.text(), name));
    case 'docx':
      return fromRaw(await readDocx(await blob.arrayBuffer(), name));
    case 'pptx':
    case 'gslides':
      return fromRaw(await readPptx(await blob.arrayBuffer(), name));
    case 'epub':
      return fromRaw(await readEpub(await blob.arrayBuffer(), name));
    case 'pdf': {
      const tools = opts.pdf ?? (await import('./readers/pdfBrowser')).browserPdfTools;
      const doc = await tools.open(await blob.arrayBuffer());
      const { readPdf } = await import('./readers/pdf');
      const raw = await readPdf(doc, name, {
        ocr: tools.ocr,
        forceOcr: opts.forceOcr,
        onProgress: (p: PdfProgress) =>
          opts.onProgress?.(p.stage === 'ocr' ? `Reading scanned page ${p.page} of ${p.pages} (OCR)…` : `Reading page ${p.page} of ${p.pages}…`, p.page / p.pages),
      });
      return fromRaw(raw);
    }
  }
}
