// Shared HTML/XHTML → blocks walker (DOCX via mammoth, EPUB chapters).

import type { Block } from '../types';
import { tableRowWithHeaders } from '../../tts/mathSpeech';

const SKIP = new Set(['script', 'style', 'nav', 'figure', 'img', 'svg', 'math', 'head', 'title']);

/**
 * Walks `root` in reading order. `extra` runs on each paragraph-like element
 * before its text is taken (used to strip and collect footnote references).
 */
export function htmlBlocks(root: Element, out: Block[], extra?: (el: Element) => Block[]): void {
  for (const el of Array.from(root.children)) {
    const tag = el.localName.toLowerCase();
    if (SKIP.has(tag)) continue;
    if (isFootnoteElement(el)) {
      const text = clean(el.textContent);
      if (text) out.push({ kind: 'footnote', text });
      continue;
    }
    if (/^h[1-6]$/.test(tag)) {
      const text = clean(el.textContent);
      if (text) out.push({ kind: 'heading', text, level: Math.min(3, Number(tag[1])) });
      continue;
    }
    if (tag === 'p' || tag === 'li' || tag === 'dt' || tag === 'dd' || tag === 'figcaption') {
      if (tag === 'li' && el.querySelector('p, ul, ol')) {
        htmlBlocks(el, out, extra);
        continue;
      }
      const notes = extra?.(el) ?? [];
      el.querySelectorAll('a[epub\\:type="noteref"], a[role="doc-noteref"]').forEach((a) => (a.closest('sup') ?? a).remove());
      const text = clean(el.textContent);
      if (text) out.push({ kind: 'para', text });
      out.push(...notes);
      continue;
    }
    if (tag === 'table') {
      // Rows are read with their column headers when the table has a header row.
      const rows = Array.from(el.querySelectorAll('tr'));
      const first = rows[0];
      const hasHeader = !!first && Array.from(first.children).every((c) => c.localName === 'th') && rows.length > 1;
      const headers = hasHeader ? Array.from(first.children).map((c) => clean(c.textContent)) : [];
      for (const row of hasHeader ? rows.slice(1) : rows) {
        const cells = Array.from(row.children).map((c) => clean(c.textContent));
        const text = tableRowWithHeaders(headers, cells);
        if (text) out.push({ kind: 'para', text });
      }
      continue;
    }
    if (tag === 'pre') continue; // code is not read aloud
    // Containers (div, section, blockquote, ul, ol, …): walk inside, but keep loose text.
    if (el.children.length) htmlBlocks(el, out, extra);
    else {
      const text = clean(el.textContent);
      if (text) out.push({ kind: 'para', text });
    }
  }
}

function isFootnoteElement(el: Element): boolean {
  const type = (el.getAttribute('epub:type') ?? '') + ' ' + (el.getAttribute('role') ?? '');
  return /\b(footnote|endnote|rearnote|doc-footnote|doc-endnote)\b/.test(type) || (el.localName === 'aside' && /note/i.test(el.className));
}

function clean(text: string | null): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}
