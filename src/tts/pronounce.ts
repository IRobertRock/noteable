// Pronunciation dictionary (State/pronunciations.json): fixes for names and
// jargon, applied to spoken text on the phone and the desktop alike.
//   { "from": "Mankiw", "to": "Man-kyoo" }      whole word; case-insensitive unless "from" has capitals
//   { "from": "PPF", "to": "P P F" }            acronyms: written in capitals → matched exactly
//   { "from": "\\bGDP\\b", "to": "G D P", "regex": true }

import { readJson, writeJson, type Storage } from '../storage/Storage';

export interface PronRule {
  from: string;
  to: string;
  regex?: boolean;
}

export interface PronDoc {
  version: 1;
  rules: PronRule[];
  updatedAt?: string;
}

export const PRON_PATH = 'State/pronunciations.json';

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function compileRules(rules: PronRule[]): { re: RegExp; to: string }[] {
  const out: { re: RegExp; to: string }[] = [];
  for (const r of rules) {
    if (!r.from.trim()) continue;
    try {
      if (r.regex) out.push({ re: new RegExp(r.from, 'g'), to: r.to });
      else {
        const caseSensitive = /[A-Z]/.test(r.from);
        out.push({ re: new RegExp(`(?<![\\p{L}\\p{N}])${escape(r.from.trim())}(?![\\p{L}\\p{N}])`, caseSensitive ? 'gu' : 'giu'), to: r.to });
      }
    } catch {
      // A bad regex is skipped rather than breaking generation.
    }
  }
  return out;
}

export function applyPronunciations(text: string, rules: { re: RegExp; to: string }[]): string {
  let s = text;
  for (const r of rules) s = s.replace(r.re, r.to);
  return s;
}

export async function readPronunciations(storage: Storage): Promise<PronRule[]> {
  return (await readJson<PronDoc>(storage, PRON_PATH).catch(() => null))?.rules ?? [];
}

export async function writePronunciations(storage: Storage, rules: PronRule[]): Promise<void> {
  await writeJson(storage, PRON_PATH, { version: 1, rules: rules.filter((r) => r.from.trim()), updatedAt: new Date().toISOString() } satisfies PronDoc);
}
