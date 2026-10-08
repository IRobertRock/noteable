// The browser build of pdf.js, loaded only when a PDF is imported.

import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PdfTools } from '../importDocument';
import { ocrPdf } from './ocr';
import type { PdfDoc } from './pdf';

export const browserPdfTools: PdfTools = {
  async open(data) {
    const pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    return (await pdfjs.getDocument({ data: new Uint8Array(data) }).promise) as unknown as PdfDoc;
  },
  ocr: ocrPdf,
};
