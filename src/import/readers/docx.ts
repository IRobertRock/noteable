// DOCX → RawDoc via mammoth (Word → HTML), keeping headings and footnotes.

import type { Block, RawDoc } from '../types';
import { htmlBlocks } from './html';

export async function readDocx(data: ArrayBuffer, fileName: string): Promise<RawDoc> {
  const mammoth = (await import('mammoth')).default;
  const { value: html } = await mammoth.convertToHtml({ arrayBuffer: data });
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}</body>`, 'text/html');

  // mammoth puts footnotes/endnotes in <li id="footnote-N"> at the end, linked from <a href="#footnote-N">.
  const notes = new Map<string, string>();
  for (const li of Array.from(doc.querySelectorAll('li[id^="footnote-"], li[id^="endnote-"]'))) {
    li.querySelectorAll('a[href^="#footnote-ref-"], a[href^="#endnote-ref-"]').forEach((a) => a.remove());
    notes.set(li.id, (li.textContent ?? '').replace(/\s+/g, ' ').trim());
    const list = li.parentElement;
    li.remove();
    if (list && !list.children.length) list.remove();
  }

  const blocks: Block[] = [];
  htmlBlocks(doc.body, blocks, (el) => {
    // Footnote references inside this element: drop the marker, queue the note after the paragraph.
    const ids: string[] = [];
    el.querySelectorAll('a[href^="#footnote-"], a[href^="#endnote-"]').forEach((a) => {
      const id = a.getAttribute('href')!.slice(1);
      if (notes.has(id)) ids.push(id);
      (a.closest('sup') ?? a).remove();
    });
    return ids.map((id, i) => ({ kind: 'footnote' as const, text: `${id.match(/\d+$/)?.[0] ?? i + 1} ${notes.get(id)}` }));
  });

  const firstH1 = blocks.find((b) => b.kind === 'heading' && b.level === 1);
  const title = firstH1 && blocks.filter((b) => b.kind === 'heading' && b.level === 1).length === 1 ? firstH1.text : fileName.replace(/\.[^.]+$/, '');
  return { title, blocks, removed: [] };
}
