// Rule 2: drop inline citations such as (Smith, 2019), (Smith & Jones 2019, p. 4),
// (Smith et al., 2019; Lee, 2020), [12], [3–5], [1, 4] and superscript markers.
// Parentheses that merely contain a year, like "(see 2019 report)", stay.

import type { Removed } from '../types';

const YEAR = String.raw`(?:1[5-9]\d\d|20\d\d)[a-z]?|n\.d\.|in press|forthcoming`;
const PAGES = String.raw`(?:,?\s*(?:pp?\.|para\.|ch\.)\s*[\divxlc]+(?:\s*[-–]\s*[\divxlc]+)?|,\s*\d{1,4}(?:\s*[-–]\s*\d{1,4})?)`;
// One author-year reference, e.g. "Smith & Jones, 2019, p. 4" or "World Bank 2020" or "see Lee 2021a".
const NAME = String.raw`[A-Z][\p{L}'’.-]*(?:\s+(?:[A-Z][\p{L}'’.-]*|de|van|von|der|la|le|du))*`;
const AUTHORS = String.raw`${NAME}(?:(?:,\s*|\s+(?:&|and)\s+)${NAME})*(?:,?\s+et\s+al\.?)?`;
const ONE = String.raw`(?:(?:see|see also|cf\.|e\.g\.,?|i\.e\.,?)\s+)?${AUTHORS},?\s+(?:${YEAR})(?:\s*,\s*(?:${YEAR}))*${PAGES}?`;
const AUTHOR_YEAR = new RegExp(String.raw`\s?\((?:${ONE})(?:\s*;\s*(?:${ONE}))*\)`, 'gu');
// Narrative style keeps the name: "Smith (2019) argues" → "Smith argues".
const NARRATIVE_YEAR = new RegExp(String.raw`(?<=[A-Z][\p{L}'’-]+(?:\s+et\s+al\.)?)\s\((?:${YEAR})${PAGES}?\)`, 'gu');
const NUMERIC = /\s?\[\d{1,4}(?:\s*[-–,]\s*\d{1,4})*\]/g;
const SUPERSCRIPT = /[¹²³⁰-⁹]+/g;

export function stripCitations(text: string, page?: number): { text: string; removed: Removed[] } {
  const removed: Removed[] = [];
  const take = (re: RegExp) => (s: string) =>
    s.replace(re, (m) => {
      removed.push({ reason: 'citation', text: m.trim(), page });
      return '';
    });
  let out = text;
  for (const re of [AUTHOR_YEAR, NARRATIVE_YEAR, NUMERIC, SUPERSCRIPT]) out = take(re)(out);
  // Tidy spaces left before punctuation.
  out = out.replace(/\s+([.,;:!?])/g, '$1').replace(/\s{2,}/g, ' ');
  return { text: out, removed };
}
