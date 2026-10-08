// "About 21 min of audio, ready in about 15 min on this phone."
//
// Two measured numbers, both kept on the device:
//   - characters per second of audio (how fast Kokoro speaks), from finished chapters
//   - real-time factor of this device, median of the last 5 runs

import { kvGet, kvSet } from '../db';
import type { Item } from '../model/item';

const CPS_KEY = 'estimate.charsPerSec';
const RTF_KEY = 'estimate.rtf';
export const DEFAULT_CHARS_PER_SEC = 15;
/** Suggest the desktop queue for jobs longer than this (spec: about 45 minutes). */
export const LONG_JOB_SEC = 45 * 60;

export interface Estimate {
  audioSec: number;
  charsPerSec: number;
  /** Undefined until this device has generated something. */
  generateSec?: number;
  realTimeFactor?: number;
}

export interface EstimateKv {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
}

const idbKv: EstimateKv = { get: kvGet, set: kvSet };

export async function estimate(item: Item, kv: EstimateKv = idbKv): Promise<Estimate> {
  const cps = (await kv.get<number>(CPS_KEY)) ?? DEFAULT_CHARS_PER_SEC;
  const todo = item.chapters.filter((c) => c.status !== 'done');
  const audioSec = todo.reduce((n, c) => n + c.chars, 0) / cps;
  const rtf = median((await kv.get<number[]>(RTF_KEY)) ?? []);
  return { audioSec, charsPerSec: cps, realTimeFactor: rtf, generateSec: rtf ? audioSec / rtf : undefined };
}

/** Learn from a finished run. */
export async function recordRun(item: Item, realTimeFactor: number, kv: EstimateKv = idbKv): Promise<void> {
  if (realTimeFactor > 0) {
    const history = [...((await kv.get<number[]>(RTF_KEY)) ?? []), realTimeFactor].slice(-5);
    await kv.set(RTF_KEY, history);
  }
  const done = item.chapters.filter((c) => c.status === 'done' && c.durationSec && c.chars);
  const chars = done.reduce((n, c) => n + c.chars, 0);
  const secs = done.reduce((n, c) => n + (c.durationSec ?? 0), 0);
  if (chars > 500 && secs > 30) {
    const old = (await kv.get<number>(CPS_KEY)) ?? DEFAULT_CHARS_PER_SEC;
    // Blend so one odd item doesn't swing it.
    await kv.set(CPS_KEY, Math.round((old * 0.5 + (chars / secs) * 0.5) * 100) / 100);
  }
}

export function median(xs: number[]): number | undefined {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** "about 15 min", "about 1 h 20 min", "under a minute". */
export function aboutMinutes(sec: number): string {
  const min = Math.round(sec / 60);
  if (min < 1) return 'under a minute';
  if (min < 60) return `about ${min} min`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  return `about ${h} h${rest ? ` ${rest} min` : ''}`;
}
