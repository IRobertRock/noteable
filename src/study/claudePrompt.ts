// "Ask Claude for a study guide": a ready-to-paste prompt for Claude in chat,
// which can read and write Rob's Drive. Claude saves guide.md into the item's
// folder; the item page then offers to switch the item to the guide (phase 7).

import type { Item } from '../model/item';

/** Above this, the prompt points Claude at the text files in Drive instead of pasting them. */
export const INLINE_LIMIT = 30_000;

export function studyGuidePrompt(itemPath: string, item: Item, texts: { title: string; markdown: string }[]): string {
  const folder = `Noteable/${itemPath}`;
  const total = texts.reduce((n, t) => n + t.markdown.length, 0);
  const source =
    total <= INLINE_LIMIT
      ? `Here is the cleaned text of "${item.title}":\n\n${texts.map((t) => t.markdown.trim()).join('\n\n')}`
      : `The cleaned text is in my Google Drive, one file per chapter, in ${folder}/text/ (${texts.length} files: ${texts.map((t) => t.title).join('; ')}). Please read all of them.`;

  return `Please write a study guide for me to listen to in Noteable, my audiobook app.

${source}

Write it as markdown in this exact format, and save it to my Google Drive as ${folder}/guide.md (replace it if it exists):

---
title: ${item.title} (study guide)
collection: ${item.collection}
mode: teach
voice: am_michael
sources: [${item.sources.join(', ')}]
---

## Overview
Plain-language framing of what this covers.

## Key concepts
Each concept explained in a few short paragraphs.

## Key terms
- **Term:** definition (one line each)

## Examples

## Review questions
**Q:** question

**A:** answer

## Recap

Notes:
- It will be read aloud: short sentences, no tables, no images, spell out symbols.
- Each ## heading becomes a chapter. Make the guide as long as the material needs.
- Write each review answer as its own **A:** paragraph straight after its **Q:** paragraph; the app adds a 5-second pause before every answer.
- Use the key terms format exactly ("- **Term:** definition") so the app can make flashcards from them.`;
}
