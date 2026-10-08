// Browser check for phase 5: pdf.js worker, Tesseract OCR, PPTX and DOCX import end to end.
import { PDFDocument } from 'pdf-lib';
import { importDocuments } from '../src/import/importDocument';
import type { Item } from '../src/model/item';
import { readJson, readText, type Storage } from '../src/storage/Storage';
import { FakeDrive, makeStorage } from '../test/fakeDrive';
import { buildDocx, buildPptx, buildReadingPdf } from '../test/fixtures/build';

const log = (s: string) => ((document.getElementById('log') as HTMLPreElement).textContent += s + '\n');

/** A page of text drawn on a canvas and embedded as an image: no text layer, like a scan. */
async function buildScannedPdf(): Promise<ArrayBuffer> {
  const canvas = document.createElement('canvas');
  canvas.width = 1275;
  canvas.height = 1650;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#111';
  ctx.font = '26px Georgia, serif';
  ctx.fillText('POLS 1000 Course Reader', 120, 90);
  ctx.font = 'bold 44px Georgia, serif';
  ctx.fillText('The Social Contract', 120, 220);
  ctx.font = '32px Georgia, serif';
  const lines = [
    'Political authority, on this view, rests on the',
    'consent of the governed (Locke, 1689). Citizens',
    'accept limits on their freedom in exchange for',
    'the protection of their rights and property.',
    '',
    'Critics argue that consent is rarely given in any',
    'explicit way, since most people are simply born',
    'into a state and never asked [4].',
  ];
  lines.forEach((l, i) => ctx.fillText(l, 120, 320 + i * 52));
  ctx.font = '26px Georgia, serif';
  ctx.fillText('12', 620, 1580);
  const png = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), 'image/png'));
  const pdf = await PDFDocument.create();
  const img = await pdf.embedPng(await png.arrayBuffer());
  const page = pdf.addPage([612, 792]);
  page.drawImage(img, { x: 0, y: 0, width: 612, height: 792 });
  return (await pdf.save()).buffer as ArrayBuffer;
}

async function show(storage: Storage, itemPath: string): Promise<{ titles: string[]; text: string; ocr: boolean }> {
  const item = await readJson<Item>(storage, `${itemPath}/item.json`);
  let text = '';
  for (const c of item.chapters) text += await readText(storage, `${itemPath}/${c.textFile}`);
  log(`  → ${itemPath}: ${item.chapters.map((c) => c.title).join(' | ')}${item.ocr ? ' (OCR)' : ''}`);
  log(text.split('\n').map((l) => `    ${l}`).join('\n').slice(0, 1200));
  return { titles: item.chapters.map((c) => c.title), text, ocr: !!item.ocr };
}

document.getElementById('run')!.addEventListener('click', async () => {
  const results: Record<string, unknown> = {};
  const { storage } = makeStorage(new FakeDrive());
  const file = (data: ArrayBuffer, name: string, type: string) => new File([data], name, { type });
  try {
    for (const [key, build, name, type] of [
      ['textPdf', buildReadingPdf, 'reading.pdf', 'application/pdf'],
      ['deck', () => buildPptx([{ title: 'Week 3', body: ['Opportunity cost'], layout: 'title' }, { title: 'Definition', body: ['Next best alternative (Mankiw, 2021)'], notes: 'Say it twice.' }]), 'week3.pptx', ''],
      ['docx', () => buildDocx([{ style: 'Heading1', text: 'Notes' }, { text: 'Supply rises [2].', footnote: 'Usually.' }]), 'notes.docx', ''],
      ['scannedPdf', buildScannedPdf, 'scan.pdf', 'application/pdf'],
    ] as const) {
      log(`${name}…`);
      const t = performance.now();
      const r = await importDocuments(storage, [{ kind: 'upload', file: file(await build(), name, type) }], { onProgress: (m) => log(`  ${m}`) });
      results[key] = { ...(await show(storage, r.itemPath)), removed: r.removed, seconds: Math.round((performance.now() - t) / 100) / 10 };
    }
  } catch (err) {
    log(`ERROR: ${(err as Error).stack ?? err}`);
    results.error = String(err);
  }
  (window as unknown as { importResult: unknown }).importResult = results;
  log('DONE');
});
