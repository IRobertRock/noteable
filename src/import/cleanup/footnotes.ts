// Rule 4: collect footnotes and read them at the end of their section,
// introduced as "Notes for this section."

import type { Block } from '../types';

export const NOTES_INTRO = 'Notes for this section.';

/** Moves footnote blocks to the end of the section (next heading or chapter) they appear in. */
export function placeFootnotes(blocks: Block[]): Block[] {
  const out: Block[] = [];
  let held: Block[] = [];
  const release = () => {
    if (!held.length) return;
    out.push({ kind: 'para', text: NOTES_INTRO });
    out.push(...held.map((f, i) => ({ kind: 'para' as const, text: numbered(f.text, i + 1), page: f.page })));
    held = [];
  };
  for (const b of blocks) {
    if (b.kind === 'footnote') {
      held.push(b);
      continue;
    }
    if (b.kind === 'heading' || b.kind === 'chapter') release();
    out.push(b);
  }
  release();
  return out;
}

/** "3 Smith argued…" → "Note 3: Smith argued…"; unnumbered notes get their order. */
function numbered(text: string, fallback: number): string {
  const m = text.match(/^\s*(?:\[(\d{1,3})\]|(\d{1,3})[.)]?|([*†‡§]))\s+(.*)$/s);
  if (m) return `Note ${m[1] ?? m[2] ?? fallback}: ${m[4].trim()}`;
  return `Note ${fallback}: ${text.trim()}`;
}
