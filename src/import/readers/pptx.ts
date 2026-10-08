// PPTX → RawDoc: slide text and speaker notes in slide order.
// Chapters: PowerPoint sections if the deck has them, else title/section-header
// slides, else every 10 slides. Slide numbers, footers and dates are dropped,
// and so is any text box repeated on most slides (e.g. "ECON 1000 – Fall 2026").

import type { Block, RawDoc, Removed } from '../types';
import { loadZip, parseXml, relsOf, type Zip } from './zip';

const SLIDES_PER_CHAPTER = 10;
const SKIP_PLACEHOLDERS = new Set(['sldNum', 'ftr', 'dt', 'hdr']);
const TITLE_LAYOUTS = new Set(['title', 'secHead']);

interface Slide {
  id: string;
  title: string;
  body: string[];
  notes: string[];
  titleLayout: boolean;
}

export async function readPptx(data: ArrayBuffer, fileName: string): Promise<RawDoc> {
  const zip = await loadZip(data);
  const pres = parseXml(await text(zip, 'ppt/presentation.xml'));
  const presRels = await relsOf(zip, 'ppt/presentation.xml');
  const removed: Removed[] = [];

  // sldId also appears inside the section list; only the ones in sldIdLst are slides.
  const slideRefs = byLocal(pres, 'sldId')
    .filter((el) => el.parentElement?.localName === 'sldIdLst')
    .map((el) => ({ id: el.getAttribute('id') ?? '', rid: rAttr(el, 'id') }));
  const sectionOf = new Map<string, string>();
  for (const sec of byLocal(pres, 'section')) {
    const name = sec.getAttribute('name') ?? '';
    for (const s of byLocal(sec, 'sldId')) sectionOf.set(s.getAttribute('id') ?? '', name);
  }

  const slides: Slide[] = [];
  for (const ref of slideRefs) {
    const path = presRels.get(ref.rid);
    if (!path) continue;
    slides.push(await readSlide(zip, path, ref.id, removed, slides.length + 1));
  }

  // Text boxes repeated word for word on most slides are footers. (Exact match: bullets like
  // "Step 1", "Step 2" differ only in digits and must stay.)
  const key = (t: string) => t.toLowerCase().replace(/\s+/g, ' ').trim();
  const counts = new Map<string, number>();
  for (const s of slides) for (const k of new Set(s.body.map(key))) counts.set(k, (counts.get(k) ?? 0) + 1);
  const minRepeats = Math.max(3, Math.ceil(slides.length * 0.5));
  for (const [i, s] of slides.entries()) {
    s.body = s.body.filter((t) => {
      if ((counts.get(key(t)) ?? 0) < minRepeats) return true;
      removed.push({ reason: 'header or footer', text: t, page: i + 1 });
      return false;
    });
  }

  const blocks: Block[] = [];
  const useSections = sectionOf.size > 0 && new Set(sectionOf.values()).size > 1;
  const titleSlides = slides.filter((s) => s.titleLayout).length;
  let lastSection: string | undefined;
  slides.forEach((s, i) => {
    const page = i + 1;
    if (useSections) {
      const sec = sectionOf.get(s.id) ?? lastSection ?? 'Slides';
      if (sec !== lastSection) blocks.push({ kind: 'chapter', text: sec, page });
      lastSection = sec;
    } else if (titleSlides >= 2 ? s.titleLayout || i === 0 : i % SLIDES_PER_CHAPTER === 0) {
      const end = Math.min(slides.length, i + SLIDES_PER_CHAPTER);
      blocks.push({ kind: 'chapter', text: titleSlides >= 2 || s.title ? s.title || `Slides ${page}–${end}` : `Slides ${page}–${end}`, page });
    }
    if (s.title) blocks.push({ kind: 'heading', text: s.title, level: 3, page });
    for (const t of s.body) blocks.push({ kind: 'para', text: t, page });
    for (const t of s.notes) blocks.push({ kind: 'para', text: t, page });
  });

  const first = slides[0];
  const title = first?.titleLayout && first.title ? first.title : fileName.replace(/\.[^.]+$/, '');
  return { title, blocks, removed };
}

async function readSlide(zip: Zip, path: string, id: string, removed: Removed[], page: number): Promise<Slide> {
  const xml = parseXml(await text(zip, path));
  const rels = await relsOf(zip, path, true);
  let title = '';
  const body: string[] = [];
  for (const sp of [...byLocal(xml, 'sp'), ...byLocal(xml, 'graphicFrame')]) {
    const ph = byLocal(sp, 'ph')[0];
    const type = ph?.getAttribute('type') ?? (ph ? 'body' : '');
    const paras = byLocal(sp, 'p')
      .map((p) => paragraphText(p))
      .filter(Boolean);
    if (!paras.length) continue;
    if (SKIP_PLACEHOLDERS.has(type)) {
      removed.push({ reason: type === 'sldNum' ? 'slide number' : 'header or footer', text: paras.join(' '), page });
      continue;
    }
    if (type === 'title' || type === 'ctrTitle') title = paras.join(' ');
    else body.push(...paras);
  }

  let titleLayout = false;
  const layoutPath = [...rels.values()].find((t) => t.includes('slideLayouts/'));
  if (layoutPath && zip.file(layoutPath)) {
    const layout = parseXml(await text(zip, layoutPath));
    titleLayout = TITLE_LAYOUTS.has(layout.documentElement.getAttribute('type') ?? '');
  }

  const notes: string[] = [];
  const notesPath = [...rels.values()].find((t) => t.includes('notesSlides/'));
  if (notesPath && zip.file(notesPath)) {
    const nx = parseXml(await text(zip, notesPath));
    for (const sp of byLocal(nx, 'sp')) {
      const type = byLocal(sp, 'ph')[0]?.getAttribute('type') ?? '';
      if (type !== 'body') continue;
      notes.push(...byLocal(sp, 'p').map(paragraphText).filter(Boolean));
    }
  }
  return { id, title, body, notes, titleLayout };
}

/** Text runs of one <a:p>, with line breaks as spaces and a full stop added to bullet fragments. */
function paragraphText(p: Element): string {
  let out = '';
  for (const node of Array.from(p.getElementsByTagName('*'))) {
    if (node.localName === 't') out += node.textContent ?? '';
    else if (node.localName === 'br') out += ' ';
  }
  return out.replace(/\s+/g, ' ').trim();
}

function byLocal(root: Document | Element, local: string): Element[] {
  return Array.from(root.getElementsByTagNameNS('*', local));
}

function rAttr(el: Element, name: string): string {
  return el.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', name) ?? el.getAttribute(`r:${name}`) ?? '';
}

async function text(zip: Zip, path: string): Promise<string> {
  const f = zip.file(path);
  if (!f) throw new Error(`Missing ${path} in the PowerPoint file`);
  return f.async('string');
}
