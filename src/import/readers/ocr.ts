// OCR for scanned PDFs, run on the device that starts the import (spec:
// Locked decisions → OCR). Each page is rendered at 2× and read by
// Tesseract; its lines go through the same cleanup as a text PDF.

import type { PageLines, TextLine } from '../types';
import type { OcrPages, PdfDoc } from './pdf';

const SCALE = 2;

interface RenderablePage {
  getViewport(o: { scale: number }): { width: number; height: number };
  render(o: { canvas: HTMLCanvasElement | null; canvasContext: CanvasRenderingContext2D; viewport: unknown }): { promise: Promise<void> };
}

/** OCR for single pictures (image-only slides). One Tesseract worker for the whole import. */
export function imageOcr(): { read: (image: Blob) => Promise<string>; done: () => Promise<void> } {
  let worker: Promise<import('tesseract.js').Worker> | null = null;
  return {
    async read(image) {
      worker ??= import('tesseract.js').then((t) => t.createWorker('eng'));
      const { data } = await (await worker).recognize(image);
      return data.text;
    },
    async done() {
      if (worker) await (await worker).terminate();
      worker = null;
    },
  };
}

export const ocrPdf: OcrPages = async (doc, onProgress) => {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng');
  const pages: PageLines[] = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      onProgress?.({ stage: 'ocr', page: n, pages: doc.numPages });
      const page = (await (doc as PdfDoc).getPage(n)) as unknown as RenderablePage;
      const viewport = page.getViewport({ scale: SCALE });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;

      const { data } = await worker.recognize(canvas, {}, { blocks: true, text: true });
      const lines: TextLine[] = [];
      for (const block of data.blocks ?? []) {
        for (const para of block.paragraphs) {
          para.lines.forEach((line, i) => {
            const text = line.text.replace(/\s+/g, ' ').trim();
            if (!text || line.confidence < 30) return;
            const { x0, y1, y0 } = line.bbox;
            // Line box height is roughly 1.2× the font size.
            lines.push({ text, page: n, x: x0 / SCALE, y: y1 / SCALE, fontSize: Math.round(((y1 - y0) / SCALE / 1.2) * 2) / 2, paraStart: i === 0 });
          });
        }
      }
      pages.push({ page: n, height: viewport.height / SCALE, lines });
      canvas.width = canvas.height = 0; // free memory on phones
    }
  } finally {
    await worker.terminate();
  }
  return pages;
};
