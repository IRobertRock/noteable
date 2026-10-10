// Transcribe jobs: a lecture recording in the Inbox → a Narrate item whose text is
// the transcript and whose audio is the original recording, cut into ~10-minute
// parts. Chrome decodes the file (any format it can play); Whisper small.en runs
// in Node on the CPU (about 9× real time on the 9800X3D; WebGPU in Chrome gives
// garbage output on the RX 9070 XT).

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CreateMp3Writer } from '../src/audio/mp3';
import { createItem } from '../src/import/createItem';
import { recordingTitle, sectionChapter, sectionStarts, type TimedSegment } from '../src/import/transcript';

/** Whisper hears 30 s at a time; cut there ourselves, at quiet moments (its own chunk stitching drops sentences). */
export function whisperWindows(pcm16k: Float32Array): number[] {
  return sectionStarts(pcm16k, 16000, 25, 4, 0.3, 1);
}
import { chapterFile, ITEM_FILE, type Item } from '../src/model/item';
import { basename, readJson, writeJson, type Job, type Storage } from '../src/storage/Storage';
import { DATA_DIR } from './config';
import { ENGINE_URL } from './gpuEngine';

export const WHISPER_MODEL = 'onnx-community/whisper-small.en';

export interface TranscribeDeps {
  storage: Storage;
  /** Mono PCM at `rate` Hz. */
  decode(blob: Blob, name: string, rate: number): Promise<Float32Array>;
  /** Timed text for 16 kHz mono PCM. */
  asr(pcm16k: Float32Array): Promise<TimedSegment[]>;
  createWriter: CreateMp3Writer;
  voice: string;
  onDetail?: (detail: string) => void;
  now?: () => number;
}

export function downsample24to16(pcm: Float32Array): Float32Array {
  const out = new Float32Array(Math.floor((pcm.length * 2) / 3));
  for (let i = 0; i < out.length; i++) {
    const x = i * 1.5;
    const j = Math.floor(x);
    const f = x - j;
    out[i] = pcm[j] * (1 - f) + (pcm[j + 1] ?? 0) * f;
  }
  return out;
}

export async function transcribeRecording(job: Job, d: TranscribeDeps): Promise<{ itemPath: string; realTimeFactor: number; durationSec: number }> {
  if (!job.source) throw new Error('This job has no recording.');
  const now = d.now ?? (() => performance.now());
  const t0 = now();
  const name = basename(job.source);
  d.onDetail?.('Downloading the recording…');
  const blob = await d.storage.read(job.source);

  d.onDetail?.('Decoding the audio…');
  const pcm24 = await d.decode(blob, name, 24000);
  if (pcm24.length < 24000) throw new Error('The recording is empty or could not be decoded.');
  const pcm16 = downsample24to16(pcm24);
  const durationSec = pcm24.length / 24000;
  const starts = sectionStarts(pcm16, 16000);

  const chapters: { title: string; markdown: string }[] = [];
  for (const [i, a] of starts.entries()) {
    const b = starts[i + 1] ?? pcm16.length;
    d.onDetail?.(`Transcribing part ${i + 1} of ${starts.length}`);
    const offset = a / 16000;
    const segs = (await d.asr(pcm16.subarray(a, b))).map((s) => ({ ...s, start: s.start + offset, end: s.end + offset }));
    chapters.push(sectionChapter(i, offset, b / 16000, segs));
  }

  // The item first (without moving the recording), then each part's audio, then the move:
  // if anything fails, the recording is still in the Inbox for a retry.
  const { itemPath, item } = await createItem(d.storage, {
    title: recordingTitle(name),
    collection: 'General',
    mode: 'narrate',
    voice: d.voice,
    chapters,
    sources: [],
    extra: { recording: { file: name, durationSec: Math.round(durationSec), model: WHISPER_MODEL } },
  });
  for (const [i, a] of starts.entries()) {
    d.onDetail?.(`Saving audio part ${i + 1} of ${starts.length}`);
    const from = Math.round((a / 16000) * 24000);
    const to = i + 1 < starts.length ? Math.round((starts[i + 1] / 16000) * 24000) : pcm24.length;
    const writer = await d.createWriter();
    for (let s = from; s < to; s += 24000 * 10) writer.push(pcm24.subarray(s, Math.min(to, s + 24000 * 10)));
    const audioFile = chapterFile('audio', i + 1);
    await d.storage.write(`${itemPath}/${audioFile}`, writer.finish(), 'audio/mpeg');
    const c = item.chapters[i];
    c.status = 'done';
    c.audioFile = audioFile;
    c.durationSec = Math.round((to - from) / 2400) / 10;
  }
  await d.storage.move(job.source, `${itemPath}/sources/${name}`);
  const fresh = await readJson<Item>(d.storage, `${itemPath}/${ITEM_FILE}`);
  const done: Item = {
    ...fresh,
    chapters: item.chapters,
    sources: [name],
    status: 'ready',
    updatedAt: new Date().toISOString(),
    lastGenerated: { device: 'Desktop worker', engine: 'whisper', realTimeFactor: 0, at: new Date().toISOString() },
  };
  const realTimeFactor = durationSec / Math.max(0.001, (now() - t0) / 1000);
  done.lastGenerated!.realTimeFactor = Math.round(realTimeFactor * 10) / 10;
  await writeJson(d.storage, `${itemPath}/${ITEM_FILE}`, done);
  return { itemPath, realTimeFactor, durationSec };
}

// ---- Real implementations for the worker ----

type AsrPipeline = (audio: Float32Array, opts: object) => Promise<{ text: string; chunks?: { text: string; timestamp: [number, number | null] }[] }>;

export class NodeWhisper {
  private asr: Promise<AsrPipeline> | null = null;

  constructor(private readonly model = WHISPER_MODEL) {}

  private load(): Promise<AsrPipeline> {
    this.asr ??= (async () => {
      const { pipeline } = await import('@huggingface/transformers');
      return (await pipeline('automatic-speech-recognition', this.model, { device: 'cpu', dtype: 'fp32' })) as unknown as AsrPipeline;
    })();
    this.asr.catch(() => (this.asr = null));
    return this.asr;
  }

  transcribe = async (pcm16k: Float32Array): Promise<TimedSegment[]> => {
    const asr = await this.load();
    const starts = whisperWindows(pcm16k);
    const segments: TimedSegment[] = [];
    for (const [i, a] of starts.entries()) {
      const b = starts[i + 1] ?? pcm16k.length;
      if (b - a < 1600) continue; // under 0.1 s
      const offset = a / 16000;
      const len = (b - a) / 16000;
      const out = await asr(pcm16k.subarray(a, b), { return_timestamps: true });
      for (const c of out.chunks ?? [{ text: out.text, timestamp: [0, len] as [number, number] }]) {
        segments.push({ text: c.text.trim(), start: offset + (c.timestamp[0] ?? 0), end: offset + Math.min(len, c.timestamp[1] ?? len) });
      }
    }
    return segments;
  };
}

interface DecodePage {
  noteable?: { decodeFile(rate: number): Promise<number>; decodedChunk(start: number, length: number): string; releaseDecoded(): void };
}

/** Decodes any audio Chrome can play, in a short-lived headless Chrome. */
export async function chromeDecode(blob: Blob, name: string, rate: number): Promise<Float32Array> {
  const dir = join(DATA_DIR, 'tmp');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `recording-${Date.now()}${name.match(/\.[^.]+$/)?.[0] ?? ''}`);
  writeFileSync(file, Buffer.from(await blob.arrayBuffer()));
  const puppeteer = (await import('puppeteer')).default;
  const browser = await puppeteer.launch({ headless: true, protocolTimeout: 900_000 });
  try {
    const page = await browser.newPage();
    await page.goto(ENGINE_URL, { waitUntil: 'networkidle0', timeout: 120_000 });
    await page.waitForFunction(() => !!(window as unknown as DecodePage).noteable?.decodeFile, { timeout: 60_000 });
    const input = await page.$('#recording');
    if (!input) throw new Error('The engine page has no file input (is it up to date?)');
    await (input as unknown as { uploadFile(p: string): Promise<void> }).uploadFile(file);
    const samples = await page.evaluate((r) => (window as unknown as DecodePage).noteable!.decodeFile(r), rate);
    const pcm = new Float32Array(samples);
    const step = 4_000_000;
    for (let s = 0; s < samples; s += step) {
      const b64 = await page.evaluate((a, n) => (window as unknown as DecodePage).noteable!.decodedChunk(a, n), s, step);
      const bytes = Buffer.from(b64, 'base64');
      pcm.set(new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4), s);
    }
    return pcm;
  } finally {
    await browser.close().catch(() => {});
    rmSync(file, { force: true });
  }
}
