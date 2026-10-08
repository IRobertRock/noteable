// EPUB → RawDoc: one chapter per spine document, titled from the table of contents.

import type { Block, RawDoc } from '../types';
import { htmlBlocks } from './html';
import { loadZip, parseXml, resolvePath } from './zip';

/** Spine documents shorter than this (cover, title page, copyright) merge into the next one. */
const MIN_CHAPTER_CHARS = 300;

export async function readEpub(data: ArrayBuffer, fileName: string): Promise<RawDoc> {
  const zip = await loadZip(data);
  const container = parseXml(await mustRead(zip, 'META-INF/container.xml'));
  const opfPath = container.getElementsByTagNameNS('*', 'rootfile')[0]?.getAttribute('full-path');
  if (!opfPath) throw new Error('This EPUB has no package file.');
  const opf = parseXml(await mustRead(zip, opfPath));

  const manifest = new Map<string, { href: string; type: string; props: string }>();
  for (const item of Array.from(opf.getElementsByTagNameNS('*', 'item'))) {
    manifest.set(item.getAttribute('id') ?? '', {
      href: resolvePath(opfPath, decodeURIComponent(item.getAttribute('href') ?? '')),
      type: item.getAttribute('media-type') ?? '',
      props: item.getAttribute('properties') ?? '',
    });
  }
  const spineEl = opf.getElementsByTagNameNS('*', 'spine')[0];
  const spine = Array.from(opf.getElementsByTagNameNS('*', 'itemref'))
    .filter((r) => r.getAttribute('linear') !== 'no')
    .map((r) => manifest.get(r.getAttribute('idref') ?? ''))
    .filter((m): m is { href: string; type: string; props: string } => !!m && /html/.test(m.type) && !m.props.includes('nav'));

  const titles = await tocTitles(zip, manifest, spineEl?.getAttribute('toc') ?? '');
  const bookTitle = opf.getElementsByTagNameNS('*', 'title')[0]?.textContent?.trim() || fileName.replace(/\.[^.]+$/, '');

  const blocks: Block[] = [];
  let carry: Block[] = [];
  let n = 0;
  for (const item of spine) {
    const f = zip.file(item.href);
    if (!f) continue;
    const doc = parseXml(await f.async('string'), 'application/xhtml+xml');
    const body = doc.getElementsByTagName('body')[0] ?? doc.documentElement;
    const chapterBlocks: Block[] = [];
    htmlBlocks(body, chapterBlocks);
    const size = chapterBlocks.reduce((s, b) => s + b.text.length, 0);
    if (size < MIN_CHAPTER_CHARS) {
      carry.push(...chapterBlocks.filter((b) => b.kind !== 'heading'));
      continue;
    }
    n++;
    const firstHeading = chapterBlocks.find((b) => b.kind === 'heading');
    const title = titles.get(item.href) ?? firstHeading?.text ?? `Section ${n}`;
    // The chapter title is read from the chapter break; don't read the same heading twice.
    const body2 = firstHeading && firstHeading.text === title ? chapterBlocks.filter((b) => b !== firstHeading) : chapterBlocks;
    blocks.push({ kind: 'chapter', text: title }, ...carry, ...body2);
    carry = [];
  }
  if (carry.length) blocks.push(...carry);
  return { title: bookTitle, blocks, removed: [] };
}

/** href (without #fragment) → title, from the EPUB 3 nav or the EPUB 2 NCX. */
async function tocTitles(zip: Awaited<ReturnType<typeof loadZip>>, manifest: Map<string, { href: string; type: string; props: string }>, ncxId: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const nav = [...manifest.values()].find((m) => m.props.split(/\s+/).includes('nav'));
  if (nav && zip.file(nav.href)) {
    const doc = parseXml(await zip.file(nav.href)!.async('string'), 'application/xhtml+xml');
    const tocNav = Array.from(doc.getElementsByTagName('nav')).find((n) => (n.getAttribute('epub:type') ?? '').includes('toc')) ?? doc.getElementsByTagName('nav')[0];
    for (const a of Array.from(tocNav?.getElementsByTagName('a') ?? [])) {
      const href = resolvePath(nav.href, decodeURIComponent((a.getAttribute('href') ?? '').split('#')[0]));
      const t = a.textContent?.replace(/\s+/g, ' ').trim();
      if (t && !out.has(href)) out.set(href, t);
    }
    if (out.size) return out;
  }
  const ncx = manifest.get(ncxId) ?? [...manifest.values()].find((m) => m.type === 'application/x-dtbncx+xml');
  if (ncx && zip.file(ncx.href)) {
    const doc = parseXml(await zip.file(ncx.href)!.async('string'));
    for (const np of Array.from(doc.getElementsByTagNameNS('*', 'navPoint'))) {
      const src = np.getElementsByTagNameNS('*', 'content')[0]?.getAttribute('src') ?? '';
      const label = np.getElementsByTagNameNS('*', 'text')[0]?.textContent?.trim();
      const href = resolvePath(ncx.href, decodeURIComponent(src.split('#')[0]));
      if (label && !out.has(href)) out.set(href, label);
    }
  }
  return out;
}

async function mustRead(zip: Awaited<ReturnType<typeof loadZip>>, path: string): Promise<string> {
  const f = zip.file(path);
  if (!f) throw new Error(`This EPUB is missing ${path}.`);
  return f.async('string');
}
