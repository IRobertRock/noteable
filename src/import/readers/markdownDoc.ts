// Markdown (e.g. a Google Doc exported from Drive) → RawDoc, so it goes
// through the same cleanup as other documents. Claude-written guides in the
// Inbox keep using parseGuide, which trusts their ## chapters as written.

import { marked, type Token, type Tokens } from 'marked';
import type { Block, RawDoc } from '../types';
import { tableRowWithHeaders } from '../../tts/mathSpeech';

export function readMarkdownDoc(markdown: string, title: string): RawDoc {
  const blocks: Block[] = [];
  walk(marked.lexer(markdown), blocks);
  // A Google Doc's title often repeats as its first heading.
  if (blocks[0]?.kind === 'heading' && blocks[0].text.toLowerCase() === title.toLowerCase()) blocks.shift();
  return { title, blocks, removed: [] };
}

function walk(tokens: Token[], out: Block[]): void {
  for (const t of tokens) {
    switch (t.type) {
      case 'heading': {
        const h = t as Tokens.Heading;
        out.push({ kind: 'heading', text: plain(h.text), level: Math.min(3, h.depth) });
        break;
      }
      case 'paragraph':
        out.push({ kind: 'para', text: plain((t as Tokens.Paragraph).text) });
        break;
      case 'list':
        for (const item of (t as Tokens.List).items) out.push({ kind: 'para', text: plain(item.text) });
        break;
      case 'blockquote':
        walk((t as Tokens.Blockquote).tokens, out);
        break;
      case 'table': {
        const tb = t as Tokens.Table;
        const headers = tb.header.map((c) => plain(c.text));
        for (const row of tb.rows) out.push({ kind: 'para', text: tableRowWithHeaders(headers, row.map((c) => plain(c.text))) });
        break;
      }
    }
  }
}

/** Strip inline markdown: links keep their text, images and emphasis markers go. */
function plain(md: string): string {
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]+/g, '')
    .replace(/\\([\\`*_{}[\]()#+\-.!])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}
