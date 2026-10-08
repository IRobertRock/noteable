// The one generation job running on this device. Lives outside the screens so
// moving between screens doesn't stop it.

import { createMp3Writer } from '../audio/mp3';
import type { Storage } from '../storage/Storage';
import { KokoroEngine } from '../tts/engine';
import { finishUploads, generateItem, type GenerateProgress, type GenerateResult } from './generateItem';
import { idbPending } from './pending';

export interface JobState {
  itemPath: string;
  running: boolean;
  progress?: GenerateProgress;
  result?: GenerateResult;
  error?: string;
}

type Listener = (state: JobState | null) => void;

const engine = new KokoroEngine();
const listeners = new Set<Listener>();
let current: JobState | null = null;
let controller: AbortController | null = null;

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

export async function startJob(storage: Storage, itemPath: string, voice: string): Promise<void> {
  if (current?.running) throw new Error('Another item is already generating on this device.');
  controller = new AbortController();
  set({ itemPath, running: true });
  try {
    const result = await generateItem(itemPath, voice, {
      storage,
      engine,
      createWriter: createMp3Writer,
      pending: idbPending,
      deviceName: deviceName(),
      signal: controller.signal,
      onProgress: (progress) => set({ itemPath, running: true, progress }),
    });
    set({ itemPath, running: false, progress: current?.progress, result });
  } catch (err) {
    const stopped = err instanceof DOMException && err.name === 'AbortError';
    set({ itemPath, running: false, progress: current?.progress, error: stopped ? undefined : (err as Error).message });
  }
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

export function deviceName(): string {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return 'Android phone';
  if (/iPhone|iPad/i.test(ua)) return 'iPhone';
  if (/Windows/i.test(ua)) return 'Windows PC';
  if (/Mac/i.test(ua)) return 'Mac';
  return 'Browser';
}
