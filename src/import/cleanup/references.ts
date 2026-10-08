// Rule 3: drop the reference list or bibliography, from its heading to the
// next heading of the same or higher level (or the end).

import type { Block, Removed } from '../types';

const REF_HEADING = /^(?:\d+\.?\s*)?(references|reference list|bibliography|works cited|literature cited|sources|further reading)\s*:?$/i;

export function isReferencesHeading(text: string): boolean {
  return REF_HEADING.test(text.trim());
}

export function dropReferences(blocks: Block[]): { blocks: Block[]; removed: Removed[] } {
  const out: Block[] = [];
  const removed: Removed[] = [];
  let skipping: number | null = null; // level of the references heading

  for (const b of blocks) {
    if (skipping !== null) {
      const ends = b.kind === 'chapter' || (b.kind === 'heading' && (b.level ?? 1) <= skipping);
      if (!ends) {
        drop(b);
        continue;
      }
      skipping = null;
    }
    if ((b.kind === 'heading' || b.kind === 'chapter') && isReferencesHeading(b.text)) {
      skipping = b.kind === 'chapter' ? 0 : (b.level ?? 1);
      drop(b);
      continue;
    }
    out.push(b);
  }
  return { blocks: out, removed };

  // Record what was dropped on the block before it, so it shows in the right chapter.
  function drop(b: Block) {
    const r: Removed = { reason: 'references', text: b.text, page: b.page };
    removed.push(r);
    const prev = out[out.length - 1];
    if (prev) prev.removed = [...(prev.removed ?? []), r];
  }
}
