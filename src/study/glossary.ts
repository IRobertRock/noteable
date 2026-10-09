// Course glossary: every **Term:** definition across a course's guides, one
// entry per term (first definition wins), alphabetical, as a Teach guide.

import { cardsFromMarkdown } from './cards';

export interface GlossaryTerm {
  term: string;
  definition: string;
  from: string;
  /** Different definitions found in other items. */
  also: { definition: string; from: string }[];
}

export function collectTerms(sources: { title: string; markdown: string }[]): GlossaryTerm[] {
  const byKey = new Map<string, GlossaryTerm>();
  for (const s of sources) {
    for (const c of cardsFromMarkdown('glossary', 0, s.markdown)) {
      if (c.kind !== 'term') continue;
      const key = c.front.toLowerCase().replace(/\s+/g, ' ').trim();
      const found = byKey.get(key);
      if (!found) byKey.set(key, { term: c.front, definition: c.back, from: s.title, also: [] });
      else if (found.definition.toLowerCase() !== c.back.toLowerCase() && !found.also.some((a) => a.definition.toLowerCase() === c.back.toLowerCase())) {
        found.also.push({ definition: c.back, from: s.title });
      }
    }
  }
  return [...byKey.values()].sort((a, b) => a.term.localeCompare(b.term, undefined, { sensitivity: 'base' }));
}

const GROUPS = ['A–E', 'F–J', 'K–O', 'P–T', 'U–Z'] as const;

function groupOf(term: string): string {
  const ch = term
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]/g, '')
    .charAt(0)
    .toUpperCase();
  if (!ch || /\d/.test(ch)) return '0–9';
  return GROUPS[Math.min(4, Math.floor((ch.charCodeAt(0) - 65) / 5))];
}

/** A guide file (front matter + ## chapters) ready for importMarkdown. */
export function glossaryMarkdown(course: string, terms: GlossaryTerm[]): string {
  const groups = new Map<string, GlossaryTerm[]>();
  for (const t of terms) groups.set(groupOf(t.term), [...(groups.get(groupOf(t.term)) ?? []), t]);
  const order = ['0–9', ...GROUPS].filter((g) => groups.has(g));
  const lines = ['---', `title: ${course} glossary`, `collection: ${course}`, 'mode: teach', '---', ''];
  for (const g of order) {
    lines.push(`## Terms ${g}`, '');
    for (const t of groups.get(g)!) {
      lines.push(`- **${t.term}:** ${t.definition}`);
      for (const a of t.also) lines.push(`  Also, in ${a.from}: ${a.definition}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
