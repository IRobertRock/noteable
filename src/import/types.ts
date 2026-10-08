// What every document reader produces, and what cleanup works on.

/** One line of text on a PDF page (from the text layer or OCR). */
export interface TextLine {
  text: string;
  page: number;
  /** Left edge, in points from the page's left. */
  x: number;
  /** Baseline position in points from the top of the page. */
  y: number;
  fontSize: number;
  bold?: boolean;
  /** Set by OCR, which knows paragraph boundaries better than line spacing does. */
  paraStart?: boolean;
}

export interface PageLines {
  page: number;
  /** Page height in points. */
  height: number;
  lines: TextLine[];
}

export type BlockKind = 'heading' | 'para' | 'footnote' | 'chapter';

export interface Block {
  kind: BlockKind;
  text: string;
  /** Heading level 1–3. */
  level?: number;
  page?: number;
  /** Text cleaned out of (or right before) this block, for "Show removed". */
  removed?: Removed[];
}

export type RemovedReason = 'page number' | 'header or footer' | 'citation' | 'references' | 'slide number' | 'empty';

export interface Removed {
  reason: RemovedReason;
  text: string;
  page?: number;
}

export interface RawDoc {
  title: string;
  blocks: Block[];
  removed: Removed[];
  /** Pages that came from OCR (for the preview note). */
  ocrPages?: number;
}

export interface CleanChapter {
  title: string;
  /** Chapter markdown including its `## Title` line. */
  markdown: string;
  removed: Removed[];
}
