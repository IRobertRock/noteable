// Generates an item's audio chapter by chapter on this device.
//
// Progress survives interruptions: each finished chapter is saved on the device
// first, then uploaded to audio/NN.mp3 and marked done in item.json. A restart
// skips chapters that are done in Drive or waiting on the device.

import { chapterFile, ITEM_FILE, type Item } from '../model/item';
import { readJson, readText, writeJson, type Storage } from '../storage/Storage';
import type { CreateMp3Writer } from '../audio/mp3';
import type { LoadProgress, TtsEngine } from '../tts/engine';
import { speechPlan, spokenChars } from '../tts/speechText';
import type { PendingStore } from './pending';

export interface GenerateProgress {
  phase: 'loading-model' | 'generating' | 'uploading' | 'done' | 'waiting-upload';
  model?: LoadProgress;
  device?: string;
  /** 1-based chapter number being generated. */
  chapter?: number;
  chaptersDone: number;
  chaptersTotal: number;
  /** 0–1 within the current chapter, by characters spoken. */
  chapterFraction: number;
  audioSec: number;
  elapsedSec: number;
  realTimeFactor: number;
}

export interface GenerateDeps {
  storage: Storage;
  engine: TtsEngine;
  createWriter: CreateMp3Writer;
  pending: PendingStore;
  deviceName: string;
  signal?: AbortSignal;
  onProgress?: (p: GenerateProgress) => void;
  now?: () => number;
}

export interface GenerateResult {
  /** False when audio is finished but some of it is still waiting on this device to upload. */
  uploaded: boolean;
  uploadError?: string;
  realTimeFactor: number;
}

export async function generateItem(itemPath: string, voice: string, deps: GenerateDeps): Promise<GenerateResult> {
  const { storage, engine, pending } = deps;
  const now = deps.now ?? (() => performance.now());
  const itemFile = `${itemPath}/${ITEM_FILE}`;
  let item = await readJson<Item>(storage, itemFile);

  // Changing voice part-way means starting over so the item doesn't mix voices.
  if (voice !== item.voice) {
    for (const p of await pending.list(itemPath)) await pending.delete(itemPath, p.n);
    for (const c of item.chapters) c.status = 'pending';
    item.voice = voice;
  }

  const waiting = new Set((await pending.list(itemPath)).map((p) => p.n));
  const todo = item.chapters.filter((c) => c.status !== 'done' && !waiting.has(c.n));

  // Read all chapter text now: a long job can outlive the sign-in token.
  const texts = new Map<number, string>();
  for (const c of todo) texts.set(c.n, await readText(storage, `${itemPath}/${c.textFile}`));

  item = { ...item, status: 'generating', error: undefined, updatedAt: new Date().toISOString() };
  await writeJson(storage, itemFile, item);

  const progress: GenerateProgress = {
    phase: 'loading-model',
    chaptersDone: item.chapters.length - todo.length,
    chaptersTotal: item.chapters.length,
    chapterFraction: 0,
    audioSec: 0,
    elapsedSec: 0,
    realTimeFactor: 0,
  };
  const report = () => deps.onProgress?.({ ...progress });
  report();

  const loaded = await engine.load((model) => {
    progress.model = model;
    report();
  });
  progress.device = loaded.device;

  let genMs = 0;
  let uploadError: string | undefined;

  const flush = async (): Promise<void> => {
    progress.phase = 'uploading';
    report();
    try {
      item = await uploadPending(itemPath, item, storage, pending);
      uploadError = undefined;
    } catch (err) {
      uploadError = err instanceof Error ? err.message : String(err);
    }
  };

  try {
    for (const ch of todo) {
      checkAbort(deps.signal);
      progress.phase = 'generating';
      progress.chapter = ch.n;
      progress.chapterFraction = 0;
      report();

      const plan = speechPlan(texts.get(ch.n) ?? '');
      const total = Math.max(1, spokenChars(plan));
      let said = 0;
      const writer = await deps.createWriter();
      for (const step of plan) {
        checkAbort(deps.signal);
        if ('pause' in step) {
          writer.silence(step.pause);
          continue;
        }
        const t0 = now();
        const pcm = await engine.generate(step.say, voice);
        genMs += now() - t0;
        writer.push(pcm);
        said += step.say.length;
        progress.chapterFraction = said / total;
        progress.audioSec += pcm.length / 24000;
        progress.elapsedSec = genMs / 1000;
        progress.realTimeFactor = genMs ? progress.audioSec / (genMs / 1000) : 0;
        report();
      }
      await pending.put({ itemPath, n: ch.n, blob: writer.finish(), durationSec: writer.durationSec });
      progress.chaptersDone++;
      await flush();
    }
  } catch (err) {
    // Keep finished chapters; mark the item so the app offers Resume.
    item = { ...item, status: 'draft', error: isAbort(err) ? undefined : String((err as Error).message ?? err) };
    await writeJson(storage, itemFile, item).catch(() => {});
    throw err;
  }

  await flush();
  if (!uploadError && progress.realTimeFactor) {
    item.lastGenerated = { device: deps.deviceName, engine: loaded.device, realTimeFactor: round(progress.realTimeFactor), at: new Date().toISOString() };
    await writeJson(storage, itemFile, item).catch(() => {});
  }
  progress.phase = uploadError ? 'waiting-upload' : 'done';
  report();
  return { uploaded: !uploadError, uploadError, realTimeFactor: progress.realTimeFactor };
}

/** Uploads anything left on the device for this item (after a Reconnect tap). */
export async function finishUploads(itemPath: string, storage: Storage, pending: PendingStore): Promise<void> {
  const item = await readJson<Item>(storage, `${itemPath}/${ITEM_FILE}`);
  await uploadPending(itemPath, item, storage, pending);
}

/** Uploads waiting MP3s, marks their chapters done and saves item.json. */
async function uploadPending(itemPath: string, item: Item, storage: Storage, pending: PendingStore): Promise<Item> {
  const chapters = item.chapters.map((c) => ({ ...c }));
  const waiting = await pending.list(itemPath);
  for (const p of waiting) {
    const audioFile = chapterFile('audio', p.n);
    await storage.write(`${itemPath}/${audioFile}`, p.blob, 'audio/mpeg');
    const ch = chapters.find((c) => c.n === p.n);
    if (ch) Object.assign(ch, { status: 'done', audioFile, durationSec: round(p.durationSec) });
  }
  const allDone = chapters.every((c) => c.status === 'done');
  const next: Item = { ...item, chapters, status: allDone ? 'ready' : 'generating', updatedAt: new Date().toISOString() };
  await writeJson(storage, `${itemPath}/${ITEM_FILE}`, next);
  // Only forget the local copies once item.json records them as done.
  for (const p of waiting) await pending.delete(itemPath, p.n);
  return next;
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
