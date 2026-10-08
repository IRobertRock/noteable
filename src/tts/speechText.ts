// Chapter markdown → a plan of things to say and silences to insert.

import { marked, type Token, type Tokens } from 'marked';
import { textToGroups } from './chunk';

export type SpeechStep = { say: string } | { pause: number };

/** Silence after a heading, between paragraphs, and between groups inside a paragraph. */
export const GAP = { heading: 0.7, paragraph: 0.45, group: 0.12, chapterStart: 0.6 } as const;

const PAUSE_MARKER = /\[pause\s+(\d+(?:\.\d+)?)\s*s(?:ec(?:onds?)?)?\]/gi;

export function speechPlan(markdown: string): SpeechStep[] {
  const steps: SpeechStep[] = [{ pause: GAP.chapterStart }];
  for (const block of blocks(marked.lexer(markdown))) {
    if (block.kind === 'pause') {
      steps.push({ pause: block.seconds });
      continue;
    }
    // Inline [pause Ns] markers inside a paragraph split it.
    const pieces = block.text.split(PAUSE_MARKER);
    pieces.forEach((piece, i) => {
      if (i % 2 === 1) {
        steps.push({ pause: Math.min(60, Number(piece)) });
        return;
      }
      const groups = textToGroups(piece);
      groups.forEach((g, j) => {
        steps.push({ say: g });
        if (j < groups.length - 1) steps.push({ pause: GAP.group });
      });
    });
    steps.push({ pause: block.kind === 'heading' ? GAP.heading : GAP.paragraph });
  }
  return mergePauses(steps);
}

export function spokenChars(plan: SpeechStep[]): number {
  return plan.reduce((n, s) => n + ('say' in s ? s.say.length : 0), 0);
}

type Block = { kind: 'heading' | 'para'; text: string } | { kind: 'pause'; seconds: number };

function blocks(tokens: Token[]): Block[] {
  const out: Block[] = [];
  for (const t of tokens) {
    switch (t.type) {
      case 'heading':
        out.push({ kind: 'heading', text: sentence(inline((t as Tokens.Heading).tokens)) });
        break;
      case 'paragraph':
      case 'text': {
        const text = inline((t as Tokens.Paragraph).tokens ?? []) || (t as Tokens.Text).text;
        const only = text.trim().match(/^\[pause\s+(\d+(?:\.\d+)?)\s*s(?:ec(?:onds?)?)?\]$/i);
        if (only) out.push({ kind: 'pause', seconds: Math.min(60, Number(only[1])) });
        else if (text.trim()) out.push({ kind: 'para', text: sentence(text) });
        break;
      }
      case 'list':
        for (const item of (t as Tokens.List).items) {
          const text = blocks(item.tokens)
            .map((b) => ('text' in b ? b.text : ''))
            .join(' ');
          if (text.trim()) out.push({ kind: 'para', text: sentence(text) });
        }
        break;
      case 'blockquote':
        out.push(...blocks((t as Tokens.Blockquote).tokens));
        break;
      case 'table': {
        const table = t as Tokens.Table;
        const row = (cells: Tokens.TableCell[]) => sentence(cells.map((c) => inline(c.tokens)).join(', '));
        out.push({ kind: 'para', text: row(table.header) });
        for (const r of table.rows) out.push({ kind: 'para', text: row(r) });
        break;
      }
      // code blocks, html, hr and spacing are not read aloud
    }
  }
  return out;
}

function inline(tokens: Token[]): string {
  return tokens
    .map((t) => {
      switch (t.type) {
        case 'strong': {
          const text = inline((t as Tokens.Strong).tokens).trim();
          if (/^Q:?$/i.test(text)) return 'Question. ';
          if (/^A:?$/i.test(text)) return 'Answer. ';
          return text;
        }
        case 'em':
        case 'del':
        case 'link':
          return inline((t as Tokens.Em).tokens);
        case 'image':
          return (t as Tokens.Image).text;
        case 'codespan':
          return (t as Tokens.Codespan).text;
        case 'br':
          return ' ';
        case 'escape':
          return (t as Tokens.Escape).text;
        case 'html':
          return '';
        case 'text': {
          const tt = t as Tokens.Text;
          return tt.tokens ? inline(tt.tokens) : decode(tt.text);
        }
        default:
          return 'text' in t ? decode(String(t.text)) : '';
      }
    })
    .join('');
}

function sentence(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return t;
  return /[.!?…:;]["'”’)\]]*$/.test(t) ? t : `${t}.`;
}

function decode(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function mergePauses(steps: SpeechStep[]): SpeechStep[] {
  const out: SpeechStep[] = [];
  for (const s of steps) {
    const last = out[out.length - 1];
    if ('pause' in s && last && 'pause' in last) last.pause = Math.max(last.pause, s.pause);
    else out.push({ ...s });
  }
  return out;
}
