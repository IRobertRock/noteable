// The one generation job running on this device. Lives outside the screens so
// moving between screens doesn't stop it.

import { createMp3Writer } from '../audio/mp3';
import { kvGet, kvSet } from '../db';
import { ITEM_FILE, type Item } from '../model/item';
import { holdWakeLock, releaseWakeLock } from '../sleep/wakeLock';
import { readJson, type Storage } from '../storage/Storage';
import { KokoroEngine } from '../tts/engine';
import { recordRun } from './estimate';
import { finishUploads, generateItem, type GenerateProgress, type GenerateResult } from './generateItem';
import { idbCheckpoints, idbPending } from './pending';

export interface JobState {
  itemPath: string;
  running: boolean;
  progress?: GenerateProgress;
  /** Audio still to generate, from the item's character counts (for "x min left"). */
  remainingAudioSec?: number;
  /** Time the job spent paused because the app was in the background. */
  pausedSec: number;
  result?: GenerateResult;
  error?: string;
}

type Listener = (state: JobState | null) => void;

const engine = new KokoroEngine();
const listeners = new Set<Listener>();
let current: JobState | null = null;
let controller: AbortController | null = null;
let hiddenAt: number | null = null;

export function currentJob(): JobState | null {
  return current;
}

export function onJobChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function set(state: JobState | null): void {
  current = state;
  for (const fn of listeners) fn(current);
}

// Android pauses the page when it's hidden; count that time so it can be shown.
document.addEventListener('visibilitychange', () => {
  if (!current?.running) return;
  if (document.visibilityState === 'hidden') hiddenAt = Date.now();
  else if (hiddenAt) {
    set({ ...current, pausedSec: current.pausedSec + (Date.now() - hiddenAt) / 1000 });
    hiddenAt = null;
  }
});

/** `item` and `charsPerSec` are only used to show time left. */
export async function startJob(storage: Storage, itemPath: string, voice: string, item: Item, charsPerSec: number): Promise<void> {
  if (current?.running) throw new Error('Another item is already generating on this device.');
  const sizes = chapterSizes(item);
  controller = new AbortController();
  set({ itemPath, running: true, pausedSec: 0 });
  await holdWakeLock();
  try {
    const result = await generateItem(itemPath, voice, {
      storage,
      engine,
      createWriter: createMp3Writer,
      pending: idbPending,
      checkpoints: idbCheckpoints,
      deviceName: deviceName(),
      signal: controller.signal,
      onProgress: (progress) => set({ ...current!, running: true, progress, remainingAudioSec: remaining(progress, sizes, charsPerSec) }),
    });
    set({ ...current!, running: false, result });
    const finished = await readJson<Item>(storage, `${itemPath}/${ITEM_FILE}`).catch(() => null);
    if (finished) await recordRun(finished, result.realTimeFactor);
  } catch (err) {
    const stopped = err instanceof DOMException && err.name === 'AbortError';
    set({ ...current!, running: false, error: stopped ? undefined : (err as Error).message });
  } finally {
    await releaseWakeLock();
  }
}

interface ChapterSizes {
  total: number;
  /** Characters in chapters before chapter n, and in chapter n. */
  before: Map<number, number>;
  size: Map<number, number>;
}

function chapterSizes(item: Item): ChapterSizes {
  const before = new Map<number, number>();
  const size = new Map<number, number>();
  let sum = 0;
  for (const c of item.chapters) {
    before.set(c.n, sum);
    size.set(c.n, c.chars);
    sum += c.chars;
  }
  return { total: sum, before, size };
}

function remaining(p: GenerateProgress, sizes: ChapterSizes, charsPerSec: number): number | undefined {
  if (!sizes.total || p.chapter === undefined) return undefined;
  const done = (sizes.before.get(p.chapter) ?? 0) + (sizes.size.get(p.chapter) ?? 0) * p.chapterFraction;
  return Math.max(0, sizes.total - done) / charsPerSec;
}

export function stopJob(): void {
  controller?.abort();
}

export async function retryUploads(storage: Storage, itemPath: string): Promise<void> {
  await finishUploads(itemPath, storage, idbPending);
  if (current?.itemPath === itemPath && current.result) {
    set({ ...current, result: { ...current.result, uploaded: true, uploadError: undefined } });
  }
}

export async function waitingChapters(itemPath: string): Promise<number> {
  return (await idbPending.list(itemPath)).length;
}

/**
 * A short sample of a voice, generated once on this device and cached. The first
 * sample on a device downloads the voice model (~310 MB).
 */
export async function voiceSample(voiceId: string, name: string): Promise<Float32Array> {
  const key = `sample.${voiceId}`;
  const cached = await kvGet<Float32Array>(key);
  if (cached) return cached;
  await engine.load();
  const pcm = await engine.generate(`Hello, I'm ${name}. This is how I sound in Noteable.`, voiceId);
  await kvSet(key, pcm);
  return pcm;
}

let sampleCtx: AudioContext | null = null;
export function playPcm(pcm: Float32Array): void {
  sampleCtx ??= new AudioContext();
  const buf = sampleCtx.createBuffer(1, pcm.length, 24000);
  buf.copyToChannel(new Float32Array(pcm), 0);
  const src = sampleCtx.createBufferSource();
  src.buffer = buf;
  src.connect(sampleCtx.destination);
  src.start();
}

export function deviceName(): string {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return 'Android phone';
  if (/iPhone|iPad/i.test(ua)) return 'iPhone';
  if (/Windows/i.test(ua)) return 'Windows PC';
  if (/Mac/i.test(ua)) return 'Mac';
  return 'Browser';
}
