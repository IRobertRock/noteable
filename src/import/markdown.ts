// Guide / markdown file → header + chapters. Each `##` heading starts a chapter.

import { parse as parseYaml } from 'yaml';

export interface GuideMeta {
  title: string;
  collection: string;
  mode: 'narrate' | 'teach';
  voice?: string;
  sources?: string[];
}

export interface ParsedChapter {
  title: string;
  /** Chapter markdown including its `## Title` line. */
  markdown: string;
}

export interface ParsedGuide {
  meta: GuideMeta;
  chapters: ParsedChapter[];
  warnings: string[];
}

const FRONT_MATTER = /^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

export function parseGuide(text: string, fileName: string): ParsedGuide {
  const warnings: string[] = [];
  let header: Record<string, unknown> = {};
  let body = text.replace(/^﻿/, '');

  const fm = body.match(FRONT_MATTER);
  if (fm) {
    body = body.slice(fm[0].length);
    try {
      const parsed = parseYaml(fm[1]) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) header = parsed as Record<string, unknown>;
      else warnings.push('The header is not a list of key: value lines; it was ignored.');
    } catch (err) {
      warnings.push(`Could not read the header: ${(err as Error).message}`);
    }
  }

  // A leading "# Title" names the item when the header doesn't.
  let title = str(header.title);
  const h1 = body.match(/^\s*#\s+(.+?)\s*#*\s*(?:\r?\n|$)/);
  if (h1) {
    title ??= h1[1].trim();
    body = body.slice(h1[0].length);
  }
  title ??= fileName.replace(/\.[^.]+$/, '').trim() || 'Untitled';

  const mode = header.mode === 'teach' ? 'teach' : 'narrate';
  const sources = Array.isArray(header.sources) ? header.sources.map(String) : undefined;

  return {
    meta: { title, collection: str(header.collection) ?? 'General', mode, voice: str(header.voice), sources },
    chapters: splitChapters(body, title),
    warnings,
  };
}

function splitChapters(body: string, itemTitle: string): ParsedChapter[] {
  const lines = body.split(/\r?\n/);
  const chapters: { title: string; lines: string[] }[] = [];
  let current: { title: string; lines: string[] } = { title: 'Introduction', lines: [] };
  let fence: string | null = null;

  for (const line of lines) {
    const f = line.match(/^\s*(```|~~~)/);
    if (f) fence = fence === f[1] ? null : (fence ?? f[1]);
    const h2 = fence ? null : line.match(/^##\s+(.+?)\s*#*\s*$/);
    if (h2) {
      chapters.push(current);
      current = { title: h2[1].trim(), lines: [line] };
    } else {
      current.lines.push(line);
    }
  }
  chapters.push(current);

  const hasText = (c: { lines: string[] }) => c.lines.some((l) => l.trim() && !/^##\s/.test(l));
  const kept = chapters.filter((c, i) => (i === 0 ? hasText(c) : true));
  if (kept.length === 0) return [];
  // A file with no ## headings is one chapter named after the item.
  if (kept.length === 1 && kept[0].title === 'Introduction' && chapters.length === 1) kept[0].title = itemTitle;

  return kept.map((c) => {
    const lines = c.lines[0]?.startsWith('##') ? c.lines : [`## ${c.title}`, '', ...c.lines];
    return { title: c.title, markdown: trimBlank(lines).join('\n') + '\n' };
  });
}

function trimBlank(lines: string[]): string[] {
  let a = 0;
  let b = lines.length;
  while (a < b && !lines[a].trim()) a++;
  while (b > a && !lines[b - 1].trim()) b--;
  return lines.slice(a, b);
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : undefined;
}
